package endpoints

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"sort"
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

const ledgerPrefix = "ledgers/"

func LedgerGet(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	ledgerType := request.QueryStringParameters["type"]
	if ledgerType == "" {
		fmt.Printf("Missing ledger type\n")
		return events.APIGatewayProxyResponse{Body: `{"error": "Type is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}
	month := request.QueryStringParameters["month"]
	dirPath := ledgerPrefix + ledgerType

	if month != "" {
		if _, err := time.Parse("2006-01", month); err != nil {
			fmt.Printf("Invalid month: %s - Error: %v\n", month, err)
			return events.APIGatewayProxyResponse{Body: `{"error": "Month must be YYYY-MM"}`, StatusCode: 400, Headers: deps.Headers}, nil
		}
		path := fmt.Sprintf("%s/%s.json", dirPath, month)
		content, err := deps.Data.Get(path)
		var ledger MonthlyLedger
		if err != nil {
			openingBalance, foundPrev := findPreviousClosingBalance(dirPath, month, deps)
			if foundPrev {
				ledger.OpeningBalance = openingBalance
				ledger.ClosingBalance = openingBalance
			}
		}
		if err := json.Unmarshal(content, &ledger); err != nil {
			fmt.Printf("Invalid ledger format: %s - Error: %v\n", path, err)
			return events.APIGatewayProxyResponse{Body: `{"error": "Invalid ledger format"}`, StatusCode: 400, Headers: deps.Headers}, nil
		}

		body, _ := json.Marshal(ledger)
		return events.APIGatewayProxyResponse{Body: string(body), StatusCode: 200, Headers: deps.Headers}, nil
	}

	items, err := deps.Data.List(dirPath)
	if err != nil {
		if strings.Contains(err.Error(), "NoSuchKey") || strings.Contains(err.Error(), "no such file") {
			return events.APIGatewayProxyResponse{Body: "[]", StatusCode: 200, Headers: deps.Headers}, nil
		}
		return errorResponse(err, deps.Headers), nil
	}

	var allLedgers []MonthlyLedger
	for _, item := range items {
		if strings.HasSuffix(item.Name, ".json") {
			content, err := deps.Data.Get(item.Path)
			if err != nil {
				fmt.Printf("Failed to read ledger: %s - Error: %v\n", item.Path, err)
				continue
			}
			var ledger MonthlyLedger
			if err := json.Unmarshal(content, &ledger); err != nil {
				fmt.Printf("Invalid ledger format: %s - Error: %v\n", item.Path, err)
				continue
			}
			allLedgers = append(allLedgers, ledger)
		}
	}

	for i := 0; i < len(allLedgers); i++ {
		for j := i + 1; j < len(allLedgers); j++ {
			if allLedgers[i].Month > allLedgers[j].Month {
				allLedgers[i], allLedgers[j] = allLedgers[j], allLedgers[i]
			}
		}
	}

	body, _ := json.Marshal(allLedgers)
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
