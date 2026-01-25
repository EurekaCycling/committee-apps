package endpoints

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

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

func LedgerGet(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	ledgerType := request.QueryStringParameters["type"]
	if ledgerType == "" {
		return events.APIGatewayProxyResponse{Body: `{"error": "Type is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}
	dirPath := fmt.Sprintf("ledgers/%s", ledgerType)

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
				continue
			}
			var ledger MonthlyLedger
			if err := json.Unmarshal(content, &ledger); err == nil {
				allLedgers = append(allLedgers, ledger)
			}
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

func LedgerPost(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	ledgerType := request.QueryStringParameters["type"]
	if ledgerType == "" {
		return events.APIGatewayProxyResponse{Body: `{"error": "Type is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}
	dirPath := fmt.Sprintf("ledgers/%s", ledgerType)

	var ledgers []MonthlyLedger
	if err := json.Unmarshal([]byte(request.Body), &ledgers); err != nil {
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
