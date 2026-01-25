package endpoints

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
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
			return 0, false
		}
		var prevLedger MonthlyLedger
		if err := json.Unmarshal(content, &prevLedger); err != nil {
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
