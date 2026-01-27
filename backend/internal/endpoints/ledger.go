package endpoints

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/go-pdf/fpdf"
)

type Transaction struct {
	ID             string  `json:"id"`
	Date           string  `json:"date"`
	Category       string  `json:"category"`
	Description    string  `json:"description"`
	Amount         float64 `json:"amount"`
	RunningBalance float64 `json:"runningBalance"`
}

type MonthlyLedger struct {
	PK             string        `json:"pk"`
	Month          string        `json:"month"`
	Type           string        `json:"type"`
	OpeningBalance float64       `json:"openingBalance"`
	ClosingBalance float64       `json:"closingBalance"`
	Transactions   []Transaction `json:"transactions"`
}

const ledgerPrefix = "ledger/"

type bankImportRequest struct {
	CSV            string   `json:"csv"`
	CurrentBalance *float64 `json:"currentBalance"`
	Type           string   `json:"type"`
}

type bankImportRow struct {
	OrigIdx        int
	Date           time.Time
	Amount         float64
	Description    string
	Category       string
	Month          string
	DateISO        string
	RunningBalance float64
	ID             string
}

type bankImportResponse struct {
	Status         string   `json:"status"`
	Type           string   `json:"type"`
	Months         []string `json:"months"`
	Count          int      `json:"count"`
	Transactions   int      `json:"transactions"`
	OpeningBalance float64  `json:"openingBalance"`
	ClosingBalance float64  `json:"closingBalance"`
}

func LedgerGet(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	ledgerType := request.QueryStringParameters["type"]
	if ledgerType == "" {
		fmt.Printf("Missing ledger type\n")
		return events.APIGatewayProxyResponse{Body: `{"error": "Type is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}
	month := request.QueryStringParameters["month"]
	if month == "" {
		// No month specified error
		fmt.Printf("Missing ledger month\n")
		return events.APIGatewayProxyResponse{Body: `{"error": "Month is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	if _, err := time.Parse("2006-01", month); err != nil {
		fmt.Printf("Invalid month: %s - Error: %v\n", month, err)
		return events.APIGatewayProxyResponse{Body: `{"error": "Month must be YYYY-MM"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	dirPath := ledgerPrefix + ledgerType
	path := fmt.Sprintf("%s/%s.json", dirPath, month)
	content, err := deps.Data.Get(path)
	var ledger MonthlyLedger
	if err != nil {
		fmt.Printf("Ledger not found: %s - %v\n", path, err)
		openingBalance, foundPrev := findPreviousClosingBalance(dirPath, month, deps)
		if foundPrev {
			ledger.OpeningBalance = openingBalance
			ledger.ClosingBalance = openingBalance
		}
		body, _ := json.Marshal(ledger)
		return events.APIGatewayProxyResponse{Body: string(body), StatusCode: 200, Headers: deps.Headers}, nil
	}
	if err := json.Unmarshal(content, &ledger); err != nil {
		fmt.Printf("Invalid ledger format: %s - Error: %v\n", path, err)
		return events.APIGatewayProxyResponse{Body: `{"error": "Invalid ledger format"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	body, _ := json.Marshal(ledger)
	return events.APIGatewayProxyResponse{Body: string(body), StatusCode: 200, Headers: deps.Headers}, nil

}

func findPreviousClosingBalance(dirPath, month string, deps Dependencies) (float64, bool) {
	parsedMonth, err := time.Parse("2006-01", month)
	if err != nil {
		fmt.Printf("Invalid month: %s - Error: %v\n", month, err)
		return 0, false
	}
	for i := 0; i < 6; i++ {
		parsedMonth = parsedMonth.AddDate(0, -1, 0)
		prevMonth := parsedMonth.Format("2006-01")
		path := fmt.Sprintf("%s/%s.json", dirPath, prevMonth)
		content, err := deps.Data.Get(path)
		if err != nil {
			if strings.Contains(err.Error(), "NoSuchKey") || strings.Contains(err.Error(), "no such file") {
				continue
			}
			fmt.Printf("Failed to read ledger: %s - Error: %v\n", path, err)
			return 0, false
		}
		var prevLedger MonthlyLedger
		if err := json.Unmarshal(content, &prevLedger); err != nil {
			fmt.Printf("Invalid ledger format: %s - Error: %v\n", path, err)
			return 0, false
		}
		return prevLedger.ClosingBalance, true
	}
	return 0, false
}

func LedgerPost(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	ledgerType := request.QueryStringParameters["type"]
	if ledgerType == "" {
		fmt.Printf("Missing ledger type\n")
		return events.APIGatewayProxyResponse{Body: `{"error": "Type is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}
	dirPath := ledgerPrefix + ledgerType

	var ledgers []MonthlyLedger
	if err := json.Unmarshal([]byte(request.Body), &ledgers); err != nil {
		fmt.Printf("Invalid ledger post format - Error: %v\n", err)
		return events.APIGatewayProxyResponse{Body: `{"error": "Invalid format"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	for _, ledger := range ledgers {
		path := fmt.Sprintf("%s/%s.json", dirPath, ledger.Month)
		content, _ := json.Marshal(ledger)
		if err := deps.Data.Save(path, content); err != nil {
			return errorResponse(err, deps.Headers), nil
		}
	}
	return events.APIGatewayProxyResponse{Body: `{"status":"ok"}`, StatusCode: 200, Headers: deps.Headers}, nil
}

func LedgerBankImport(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	ledgerType := strings.TrimSpace(request.QueryStringParameters["type"])
	currentBalanceRaw := strings.TrimSpace(request.QueryStringParameters["currentBalance"])
	varCurrentBalance := (*float64)(nil)
	if currentBalanceRaw != "" {
		parsed, err := strconv.ParseFloat(currentBalanceRaw, 64)
		if err != nil {
			return events.APIGatewayProxyResponse{Body: `{"error": "Current balance must be a number"}`, StatusCode: 400, Headers: deps.Headers}, nil
		}
		varCurrentBalance = &parsed
	}

	csvData := strings.TrimSpace(request.Body)
	var body bankImportRequest
	if err := json.Unmarshal([]byte(request.Body), &body); err == nil {
		if strings.TrimSpace(body.CSV) != "" {
			csvData = body.CSV
		}
		if ledgerType == "" {
			ledgerType = strings.TrimSpace(body.Type)
		}
		if varCurrentBalance == nil && body.CurrentBalance != nil {
			varCurrentBalance = body.CurrentBalance
		}
	}

	if ledgerType == "" {
		ledgerType = "BANK"
	}
	ledgerType = strings.ToUpper(ledgerType)

	if varCurrentBalance == nil {
		return events.APIGatewayProxyResponse{Body: `{"error": "Current balance is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}
	if csvData == "" {
		return events.APIGatewayProxyResponse{Body: `{"error": "CSV content is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	rows, err := parseBankImportRows(csvData)
	if err != nil {
		return events.APIGatewayProxyResponse{Body: fmt.Sprintf(`{"error": "%s"}`, err.Error()), StatusCode: 400, Headers: deps.Headers}, nil
	}
	ledgers, months, openingBalance, closingBalance, err := buildBankImportLedgers(rows, ledgerType, *varCurrentBalance)
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}

	dirPath := ledgerPrefix + ledgerType
	for _, month := range months {
		ledger := ledgers[month]
		path := fmt.Sprintf("%s/%s.json", dirPath, month)
		content, _ := json.Marshal(ledger)
		if err := deps.Data.Save(path, content); err != nil {
			return errorResponse(err, deps.Headers), nil
		}
	}

	response := bankImportResponse{
		Status:         "ok",
		Type:           ledgerType,
		Months:         months,
		Count:          len(months),
		Transactions:   len(rows),
		OpeningBalance: openingBalance,
		ClosingBalance: closingBalance,
	}
	bodyBytes, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{Body: string(bodyBytes), StatusCode: 200, Headers: deps.Headers}, nil
}

func LedgerPdf(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	ledgerType := request.QueryStringParameters["type"]
	if ledgerType == "" {
		fmt.Printf("Missing ledger type\n")
		return events.APIGatewayProxyResponse{Body: `{"error": "Type is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}
	month := request.QueryStringParameters["month"]
	if month == "" {
		fmt.Printf("Missing ledger month\n")
		return events.APIGatewayProxyResponse{Body: `{"error": "Month is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}
	if _, err := time.Parse("2006-01", month); err != nil {
		fmt.Printf("Invalid month: %s - Error: %v\n", month, err)
		return events.APIGatewayProxyResponse{Body: `{"error": "Month must be YYYY-MM"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	dirPath := ledgerPrefix + ledgerType
	path := fmt.Sprintf("%s/%s.json", dirPath, month)
	content, err := deps.Data.Get(path)
	if err != nil {
		if strings.Contains(err.Error(), "NoSuchKey") || strings.Contains(err.Error(), "no such file") {
			fmt.Printf("Ledger not found: %s\n", path)
			return events.APIGatewayProxyResponse{Body: `{"error": "Ledger not found"}`, StatusCode: 404, Headers: deps.Headers}, nil
		}
		return errorResponse(err, deps.Headers), nil
	}
	var ledger MonthlyLedger
	if err := json.Unmarshal(content, &ledger); err != nil {
		fmt.Printf("Invalid ledger format: %s - Error: %v\n", path, err)
		return events.APIGatewayProxyResponse{Body: `{"error": "Invalid ledger format"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	openingBalance, foundPrev := findPreviousClosingBalance(dirPath, month, deps)
	if foundPrev {
		ledger.OpeningBalance = openingBalance
	}
	transactions := ledger.Transactions
	sort.Slice(transactions, func(i, j int) bool {
		return transactions[i].Date < transactions[j].Date
	})
	rows := make([]Transaction, len(transactions))
	copy(rows, transactions)
	ledgerBalance := ledger.OpeningBalance
	for i, tx := range rows {
		ledgerBalance = roundCurrency(ledgerBalance + tx.Amount)
		rows[i].RunningBalance = ledgerBalance
	}

	contentTypeHeaders := map[string]string{}
	for key, value := range deps.Headers {
		contentTypeHeaders[key] = value
	}
	contentTypeHeaders["Content-Type"] = "application/pdf"

	pdf, err := buildLedgerPdf(ledgerType, month, ledger.OpeningBalance, ledgerBalance, rows)
	if err != nil {
		fmt.Printf("Failed to build ledger PDF: %s - Error: %v\n", path, err)
		return errorResponse(err, deps.Headers), nil
	}
	encoded := base64.StdEncoding.EncodeToString(pdf)
	return events.APIGatewayProxyResponse{
		Body:            encoded,
		IsBase64Encoded: true,
		StatusCode:      200,
		Headers:         contentTypeHeaders,
	}, nil
}

func LedgerCategoriesGet(_ context.Context, _ events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	path := "categories.json"
	content, err := deps.Data.Get(path)
	if err != nil {
		if strings.Contains(err.Error(), "NoSuchKey") || strings.Contains(err.Error(), "no such file") {
			defaultCats := `["Membership", "Event Fee", "Equipment", "Reimbursement", "Sponsorship", "Misc"]`
			return events.APIGatewayProxyResponse{Body: defaultCats, StatusCode: 200, Headers: deps.Headers}, nil
		}
		return errorResponse(err, deps.Headers), nil
	}
	return events.APIGatewayProxyResponse{Body: string(content), StatusCode: 200, Headers: deps.Headers}, nil
}

func LedgerCategoriesPost(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	path := "categories.json"
	err := deps.Data.Save(path, []byte(request.Body))
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}
	return events.APIGatewayProxyResponse{Body: `{"status":"ok"}`, StatusCode: 200, Headers: deps.Headers}, nil
}

func parseBankImportRows(content string) ([]bankImportRow, error) {
	reader := csv.NewReader(strings.NewReader(content))
	reader.Comma = detectBankImportDelimiter(content)
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true

	rows := make([]bankImportRow, 0)
	lineIdx := 0
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("invalid csv: %w", err)
		}
		if len(record) < 3 {
			lineIdx++
			continue
		}
		dateRaw := strings.TrimSpace(record[0])
		amountRaw := strings.TrimSpace(record[1])
		description := strings.TrimSpace(strings.Join(record[2:], " "))
		if dateRaw == "" && amountRaw == "" && description == "" {
			lineIdx++
			continue
		}
		date, err := time.Parse("02/01/2006", dateRaw)
		if err != nil {
			lineIdx++
			continue
		}
		amount, err := strconv.ParseFloat(normalizeAmountString(amountRaw), 64)
		if err != nil {
			lineIdx++
			continue
		}

		rows = append(rows, bankImportRow{
			OrigIdx:     lineIdx,
			Date:        date,
			Amount:      amount,
			Description: description,
			Category:    categorizeBankImport(description),
		})
		lineIdx++
	}

	if len(rows) == 0 {
		return nil, fmt.Errorf("no transactions found")
	}

	return rows, nil
}

func buildBankImportLedgers(rows []bankImportRow, ledgerType string, currentBalance float64) (map[string]MonthlyLedger, []string, float64, float64, error) {
	chrono := make([]bankImportRow, len(rows))
	copy(chrono, rows)
	sort.Slice(chrono, func(i, j int) bool {
		return chrono[i].OrigIdx > chrono[j].OrigIdx
	})

	totalSum := 0.0
	for _, row := range chrono {
		totalSum += row.Amount
	}
	openingBalance := roundCurrency(currentBalance - totalSum)
	ledgerBalance := openingBalance

	for i := range chrono {
		ledgerBalance = roundCurrency(ledgerBalance + chrono[i].Amount)
		chrono[i].RunningBalance = ledgerBalance
		chrono[i].DateISO = chrono[i].Date.Format("2006-01-02")
		chrono[i].Month = chrono[i].Date.Format("2006-01")
		id, err := newUUID()
		if err != nil {
			return nil, nil, 0, 0, err
		}
		chrono[i].ID = id
		if chrono[i].Category == "" {
			chrono[i].Category = categorizeBankImport(chrono[i].Description)
		}
	}

	monthRows := make(map[string][]bankImportRow)
	for _, row := range chrono {
		monthRows[row.Month] = append(monthRows[row.Month], row)
	}
	months := make([]string, 0, len(monthRows))
	for month := range monthRows {
		months = append(months, month)
	}
	sort.Strings(months)

	ledgers := make(map[string]MonthlyLedger, len(months))
	for _, month := range months {
		rows := monthRows[month]
		sort.Slice(rows, func(i, j int) bool {
			if rows[i].Date.Equal(rows[j].Date) {
				return rows[i].OrigIdx < rows[j].OrigIdx
			}
			return rows[i].Date.Before(rows[j].Date)
		})

		first := rows[0]
		opening := roundCurrency(first.RunningBalance - first.Amount)
		closing := roundCurrency(rows[len(rows)-1].RunningBalance)
		transactions := make([]Transaction, 0, len(rows))
		for _, row := range rows {
			transactions = append(transactions, Transaction{
				ID:             row.ID,
				Date:           row.DateISO,
				Category:       row.Category,
				Description:    row.Description,
				Amount:         roundCurrency(row.Amount),
				RunningBalance: roundCurrency(row.RunningBalance),
			})
		}

		ledgers[month] = MonthlyLedger{
			PK:             fmt.Sprintf("LEDGER#%s#%s", ledgerType, month),
			Month:          month,
			Type:           ledgerType,
			OpeningBalance: opening,
			ClosingBalance: closing,
			Transactions:   transactions,
		}
	}

	return ledgers, months, openingBalance, roundCurrency(currentBalance), nil
}

func detectBankImportDelimiter(content string) rune {
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		tabs := strings.Count(trimmed, "\t")
		commas := strings.Count(trimmed, ",")
		if tabs == 0 && commas == 0 {
			return '\t'
		}
		if tabs >= commas {
			return '\t'
		}
		return ','
	}
	return ','
}

func normalizeAmountString(value string) string {
	value = strings.ReplaceAll(value, ",", "")
	value = strings.ReplaceAll(value, "$", "")
	return strings.TrimSpace(value)
}

func categorizeBankImport(description string) string {
	value := strings.ToLower(description)
	if strings.Contains(value, "tidyhq") || strings.Contains(value, "auscycling") || strings.Contains(value, "life membership") || strings.Contains(value, "membership fee") || strings.Contains(value, "affiliation") {
		return "Membership"
	}
	if strings.Contains(value, "reimburse") || strings.Contains(value, "reimbursement") {
		return "Reimbursement"
	}
	if strings.Contains(value, "lake health group") || strings.Contains(value, "spons") {
		return "Sponsorship"
	}
	if strings.Contains(value, "troph") || strings.Contains(value, "engraving") || strings.Contains(value, "weed killer") || strings.Contains(value, "star outdoor") || strings.Contains(value, "electrical services") || strings.Contains(value, "asr electrical") || strings.Contains(value, "flowers") {
		return "Equipment"
	}
	if strings.Contains(value, "entryboss") || strings.Contains(value, "square") || strings.Contains(value, "race entry") || strings.Contains(value, "entry") || strings.Contains(value, "permits") || strings.Contains(value, "raffle") {
		return "Event Fee"
	}
	return "Misc"
}

func newUUID() (string, error) {
	var uuid [16]byte
	if _, err := rand.Read(uuid[:]); err != nil {
		return "", err
	}
	uuid[6] = (uuid[6] & 0x0f) | 0x40
	uuid[8] = (uuid[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", uuid[0:4], uuid[4:6], uuid[6:8], uuid[8:10], uuid[10:16]), nil
}

func buildLedgerPdf(ledgerType, month string, openingBalance, closingBalance float64, transactions []Transaction) ([]byte, error) {
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(10, 10, 10)
	pdf.AddPage()
	pdf.SetFont("Helvetica", "B", 16)
	pdf.CellFormat(0, 10, fmt.Sprintf("Ledger %s - %s", ledgerType, month), "", 1, "L", false, 0, "")
	pdf.SetFont("Helvetica", "", 12)
	pdf.CellFormat(0, 8, fmt.Sprintf("Opening Balance: $%.2f", openingBalance), "", 1, "L", false, 0, "")

	columns := []struct {
		label string
		width float64
		align string
	}{
		{label: "Date", width: 25, align: "L"},
		{label: "Category", width: 30, align: "L"},
		{label: "Description", width: 70, align: "L"},
		{label: "Debit", width: 20, align: "R"},
		{label: "Credit", width: 20, align: "R"},
		{label: "Balance", width: 25, align: "R"},
	}

	pdf.Ln(2)
	pdf.SetFont("Helvetica", "B", 10)
	for _, column := range columns {
		pdf.CellFormat(column.width, 7, column.label, "1", 0, column.align, false, 0, "")
	}
	pdf.Ln(-1)
	pdf.SetFont("Helvetica", "", 10)

	for _, tx := range transactions {
		debit := ""
		credit := ""
		if tx.Amount < 0 {
			debit = fmt.Sprintf("%.2f", -tx.Amount)
		} else if tx.Amount > 0 {
			credit = fmt.Sprintf("%.2f", tx.Amount)
		}

		cells := []string{
			tx.Date,
			tx.Category,
			tx.Description,
			debit,
			credit,
			fmt.Sprintf("%.2f", tx.RunningBalance),
		}
		for i, column := range columns {
			pdf.CellFormat(column.width, 6, cells[i], "1", 0, column.align, false, 0, "")
		}
		pdf.Ln(-1)
	}

	pdf.Ln(4)
	pdf.SetFont("Helvetica", "B", 12)
	pdf.CellFormat(0, 8, fmt.Sprintf("Closing Balance: $%.2f", closingBalance), "", 1, "L", false, 0, "")

	var buffer bytes.Buffer
	if err := pdf.Output(&buffer); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func roundCurrency(value float64) float64 {
	return math.Round(value*100) / 100
}
