package endpoints

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
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

type bankImportResponse struct {
	Status         string   `json:"status"`
	Type           string   `json:"type"`
	Months         []string `json:"months"`
	Count          int      `json:"count"`
	Transactions   int      `json:"transactions"`
	OpeningBalance float64  `json:"openingBalance"`
	ClosingBalance float64  `json:"closingBalance"`
}

type transactionInput struct {
	Date        string  `json:"date"`
	Category    string  `json:"category"`
	Description string  `json:"description"`
	Amount      float64 `json:"amount"`
}

type transactionEditRequest struct {
	Month         string `json:"month"`
	Type          string `json:"type"`
	TransactionID string `json:"transactionId"`
	Field         string `json:"field"`
	Value         string `json:"value"`
}

func addTransactionToLedger(ledger MonthlyLedger, categories []string, input transactionInput) (*MonthlyLedger, *Transaction, error) {
	if input.Date == "" || input.Category == "" {
		return nil, nil, fmt.Errorf("date and category are required")
	}
	if math.IsNaN(input.Amount) || math.IsInf(input.Amount, 0) {
		return nil, nil, fmt.Errorf("amount must be a number")
	}
	if math.Abs(roundCurrency(input.Amount)-input.Amount) > 0.0000001 {
		return nil, nil, fmt.Errorf("amount must have two decimals")
	}

	categoryValid := false
	for _, category := range categories {
		if category == input.Category {
			categoryValid = true
			break
		}
	}
	if !categoryValid {
		return nil, nil, fmt.Errorf("category is not valid")
	}

	transactionDate, err := time.Parse("2006-01-02", input.Date)
	if err != nil {
		return nil, nil, fmt.Errorf("date must be YYYY-MM-DD")
	}
	if ledger.Month != "" {
		monthKey := transactionDate.Format("2006-01")
		if ledger.Month != monthKey {
			return nil, nil, fmt.Errorf("transaction date must match ledger month")
		}
	}

	var previousBalance float64
	if len(ledger.Transactions) > 0 {
		lastTx := ledger.Transactions[len(ledger.Transactions)-1]
		lastDate, err := time.Parse("2006-01-02", lastTx.Date)
		if err != nil {
			return nil, nil, fmt.Errorf("last transaction date is invalid")
		}
		if transactionDate.Before(lastDate) {
			return nil, nil, fmt.Errorf("transaction date cannot be older than last entry")
		}
		previousBalance = lastTx.RunningBalance
	} else {
		previousBalance = ledger.OpeningBalance
	}

	amount := roundCurrency(input.Amount)
	newBalance := roundCurrency(previousBalance + amount)
	if newBalance <= 0 {
		return nil, nil, fmt.Errorf("closing balance must be greater than 0")
	}

	id, err := newUUID()
	if err != nil {
		return nil, nil, err
	}

	newTx := Transaction{
		ID:             id,
		Date:           input.Date,
		Category:       input.Category,
		Description:    input.Description,
		Amount:         amount,
		RunningBalance: newBalance,
	}

	updatedTransactions := make([]Transaction, len(ledger.Transactions)+1)
	copy(updatedTransactions, ledger.Transactions)
	updatedTransactions[len(ledger.Transactions)] = newTx

	updatedLedger := ledger
	updatedLedger.Transactions = updatedTransactions
	updatedLedger.ClosingBalance = newBalance

	return &updatedLedger, &newTx, nil
}

func loadLedgerCategories(deps Dependencies) ([]string, error) {
	path := ledgerPrefix + "categories.json"
	content, err := deps.Data.Get(path)
	if err != nil {
		if strings.Contains(err.Error(), "NoSuchKey") || strings.Contains(err.Error(), "no such file") {
			return []string{"Membership", "Event Fee", "Equipment", "Reimbursement", "Sponsorship", "Misc"}, nil
		}
		return nil, err
	}

	var categories []string
	if err := json.Unmarshal(content, &categories); err != nil {
		return nil, err
	}
	return categories, nil
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

func LedgerTransactionsPost(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	ledgerType := strings.TrimSpace(request.QueryStringParameters["type"])
	if ledgerType == "" {
		fmt.Printf("Missing ledger type\n")
		return events.APIGatewayProxyResponse{Body: `{"message": "Type is required", "error": "Type is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}
	ledgerType = strings.ToUpper(ledgerType)

	var input transactionInput
	if err := json.Unmarshal([]byte(request.Body), &input); err != nil {
		fmt.Printf("Invalid transaction post format - Error: %v\n", err)
		return events.APIGatewayProxyResponse{Body: `{"message": "Invalid format", "error": "Invalid format"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	transactionDate, err := time.Parse("2006-01-02", input.Date)
	if err != nil {
		return events.APIGatewayProxyResponse{Body: `{"message": "Date must be YYYY-MM-DD", "error": "Date must be YYYY-MM-DD"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}
	month := transactionDate.Format("2006-01")

	categories, err := loadLedgerCategories(deps)
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}

	dirPath := ledgerPrefix + ledgerType
	path := fmt.Sprintf("%s/%s.json", dirPath, month)
	content, err := deps.Data.Get(path)
	ledger := MonthlyLedger{
		PK:             fmt.Sprintf("LEDGER#%s#%s", ledgerType, month),
		Month:          month,
		Type:           ledgerType,
		OpeningBalance: 0,
		ClosingBalance: 0,
		Transactions:   []Transaction{},
	}
	if err != nil {
		if !strings.Contains(err.Error(), "NoSuchKey") && !strings.Contains(err.Error(), "no such file") {
			return errorResponse(err, deps.Headers), nil
		}
		openingBalance, foundPrev := findPreviousClosingBalance(dirPath, month, deps)
		if foundPrev {
			ledger.OpeningBalance = openingBalance
			ledger.ClosingBalance = openingBalance
		}
	} else if err := json.Unmarshal(content, &ledger); err != nil {
		fmt.Printf("Invalid ledger format: %s - Error: %v\n", path, err)
		return events.APIGatewayProxyResponse{Body: `{"message": "Invalid ledger format", "error": "Invalid ledger format"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	updatedLedger, _, err := addTransactionToLedger(ledger, categories, input)
	if err != nil {
		return events.APIGatewayProxyResponse{Body: fmt.Sprintf(`{"message": "%s", "error": "%s"}`, err.Error(), err.Error()), StatusCode: 400, Headers: deps.Headers}, nil
	}

	updatedContent, _ := json.Marshal(updatedLedger)
	if err := deps.Data.Save(path, updatedContent); err != nil {
		return errorResponse(err, deps.Headers), nil
	}
	return events.APIGatewayProxyResponse{Body: string(updatedContent), StatusCode: 200, Headers: deps.Headers}, nil
}

func LedgerTransactionsEditPost(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	var input transactionEditRequest
	if err := json.Unmarshal([]byte(request.Body), &input); err != nil {
		fmt.Printf("Invalid transaction edit format - Error: %v\n", err)
		return events.APIGatewayProxyResponse{Body: `{"message": "Invalid format", "error": "Invalid format"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	month := strings.TrimSpace(input.Month)
	if month == "" {
		return events.APIGatewayProxyResponse{Body: `{"message": "Month is required", "error": "Month is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}
	if _, err := time.Parse("2006-01", month); err != nil {
		return events.APIGatewayProxyResponse{Body: `{"message": "Month must be YYYY-MM", "error": "Month must be YYYY-MM"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	ledgerType := strings.TrimSpace(input.Type)
	if ledgerType == "" {
		return events.APIGatewayProxyResponse{Body: `{"message": "Type is required", "error": "Type is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}
	ledgerType = strings.ToUpper(ledgerType)

	transactionID := strings.TrimSpace(input.TransactionID)
	if transactionID == "" {
		return events.APIGatewayProxyResponse{Body: `{"message": "Transaction id is required", "error": "Transaction id is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	field := strings.TrimSpace(strings.ToLower(input.Field))
	if field != "category" && field != "description" {
		return events.APIGatewayProxyResponse{Body: `{"message": "Field must be category or description", "error": "Field must be category or description"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	value := strings.TrimSpace(input.Value)
	if field == "category" {
		if value == "" {
			return events.APIGatewayProxyResponse{Body: `{"message": "Category is required", "error": "Category is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
		}
		categories, err := loadLedgerCategories(deps)
		if err != nil {
			return errorResponse(err, deps.Headers), nil
		}
		categoryValid := false
		for _, category := range categories {
			if category == value {
				categoryValid = true
				break
			}
		}
		if !categoryValid {
			return events.APIGatewayProxyResponse{Body: `{"message": "Category is not valid", "error": "Category is not valid"}`, StatusCode: 400, Headers: deps.Headers}, nil
		}
	}

	dirPath := ledgerPrefix + ledgerType
	path := fmt.Sprintf("%s/%s.json", dirPath, month)
	content, err := deps.Data.Get(path)
	if err != nil {
		if strings.Contains(err.Error(), "NoSuchKey") || strings.Contains(err.Error(), "no such file") {
			return events.APIGatewayProxyResponse{Body: `{"message": "Ledger not found", "error": "Ledger not found"}`, StatusCode: 404, Headers: deps.Headers}, nil
		}
		return errorResponse(err, deps.Headers), nil
	}

	var ledger MonthlyLedger
	if err := json.Unmarshal(content, &ledger); err != nil {
		fmt.Printf("Invalid ledger format: %s - Error: %v\n", path, err)
		return events.APIGatewayProxyResponse{Body: `{"message": "Invalid ledger format", "error": "Invalid ledger format"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	updated := false
	var updatedTx Transaction
	for idx, tx := range ledger.Transactions {
		if tx.ID != transactionID {
			continue
		}
		if field == "category" {
			tx.Category = value
		} else {
			tx.Description = value
		}
		ledger.Transactions[idx] = tx
		updatedTx = tx
		updated = true
		break
	}

	if !updated {
		return events.APIGatewayProxyResponse{Body: `{"message": "Transaction not found", "error": "Transaction not found"}`, StatusCode: 404, Headers: deps.Headers}, nil
	}

	updatedContent, _ := json.Marshal(ledger)
	if err := deps.Data.Save(path, updatedContent); err != nil {
		return errorResponse(err, deps.Headers), nil
	}

	responseBody, _ := json.Marshal(map[string]any{
		"status":      "ok",
		"transaction": updatedTx,
	})
	return events.APIGatewayProxyResponse{Body: string(responseBody), StatusCode: 200, Headers: deps.Headers}, nil
}

func LedgerBankImport(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	return handleLedgerImport(request, deps, true)
}

func LedgerImport(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	return handleLedgerImport(request, deps, false)
}

func handleLedgerImport(request events.APIGatewayProxyRequest, deps Dependencies, requireCurrentBalance bool) (events.APIGatewayProxyResponse, error) {
	ledgerType, currentBalance, csvData, err := parseLedgerImportPayload(request)
	if err != nil {
		return events.APIGatewayProxyResponse{Body: fmt.Sprintf(`{"error": "%s"}`, err.Error()), StatusCode: 400, Headers: deps.Headers}, nil
	}

	if ledgerType == "" {
		ledgerType = "BANK"
	}
	ledgerType = strings.ToUpper(ledgerType)

	if csvData == "" {
		return events.APIGatewayProxyResponse{Body: `{"error": "CSV content is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	rows, err := parseBankImportRows(csvData)
	if err != nil {
		return events.APIGatewayProxyResponse{Body: fmt.Sprintf(`{"error": "%s"}`, err.Error()), StatusCode: 400, Headers: deps.Headers}, nil
	}

	existingByMonth, err := loadLedgerImportExisting(deps, ledgerType, rows)
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}

	if currentBalance == nil {
		if requireCurrentBalance {
			return events.APIGatewayProxyResponse{Body: `{"error": "Current balance is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
		}
		dirPath := ledgerPrefix + ledgerType
		baseBalance, found, err := findLatestLedgerClosingBalance(dirPath, deps)
		if err != nil {
			return errorResponse(err, deps.Headers), nil
		}
		if !found {
			baseBalance = 0
		}
		total := sumBankImportAmounts(rows)
		inferred := roundCurrency(baseBalance + total)
		currentBalance = &inferred
	}

	ledgers, months, openingBalance, closingBalance, err := buildBankImportLedgers(rows, ledgerType, *currentBalance, existingByMonth)
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

func parseLedgerImportPayload(request events.APIGatewayProxyRequest) (string, *float64, string, error) {
	ledgerType := strings.TrimSpace(request.QueryStringParameters["type"])
	currentBalanceRaw := strings.TrimSpace(request.QueryStringParameters["currentBalance"])
	varCurrentBalance := (*float64)(nil)
	if currentBalanceRaw != "" {
		parsed, err := strconv.ParseFloat(currentBalanceRaw, 64)
		if err != nil {
			return "", nil, "", fmt.Errorf("Current balance must be a number")
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

	return ledgerType, varCurrentBalance, csvData, nil
}

func findLatestLedgerClosingBalance(dirPath string, deps Dependencies) (float64, bool, error) {
	items, err := deps.Data.List(dirPath)
	if err != nil {
		return 0, false, err
	}

	var latestMonth string
	var latestTime time.Time
	found := false
	for _, item := range items {
		if item.IsDir || !strings.HasSuffix(item.Name, ".json") {
			continue
		}
		month := strings.TrimSuffix(item.Name, ".json")
		parsed, ok := parseLedgerMonth(month)
		if !ok {
			continue
		}
		if !found || parsed.After(latestTime) {
			latestTime = parsed
			latestMonth = month
			found = true
		}
	}
	if !found {
		return 0, false, nil
	}

	path := fmt.Sprintf("%s/%s.json", dirPath, latestMonth)
	content, err := deps.Data.Get(path)
	if err != nil {
		return 0, false, err
	}
	var ledger MonthlyLedger
	if err := json.Unmarshal(content, &ledger); err != nil {
		return 0, false, err
	}
	return ledger.ClosingBalance, true, nil
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
	path := ledgerPrefix + "categories.json"
	content, err := deps.Data.Get(path)
	if err != nil {
		if strings.Contains(err.Error(), "NoSuchKey") || strings.Contains(err.Error(), "no such file") {
			fmt.Printf("Failed to load categoires: %s - Error: %v", path, err)
			defaultCats := `["Membership", "Event Fee", "Equipment", "Reimbursement", "Sponsorship", "Misc"]`
			return events.APIGatewayProxyResponse{Body: defaultCats, StatusCode: 200, Headers: deps.Headers}, nil
		}
		return errorResponse(err, deps.Headers), nil
	}
	return events.APIGatewayProxyResponse{Body: string(content), StatusCode: 200, Headers: deps.Headers}, nil
}

func LedgerCategoriesPost(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	path := ledgerPrefix + "categories.json"
	err := deps.Data.Save(path, []byte(request.Body))
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}
	return events.APIGatewayProxyResponse{Body: `{"status":"ok"}`, StatusCode: 200, Headers: deps.Headers}, nil
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
