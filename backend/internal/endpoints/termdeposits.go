package endpoints

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/aws/aws-lambda-go/events"
)

type TermDepositYear struct {
	FY           int     `json:"fy"`
	Balance      float64 `json:"balance"`
	Interest     float64 `json:"interest"`
	MaturityDate string  `json:"maturityDate"`
}

const termDepositPath = "termdeposit/deposits.json"

func loadTermDepositYears(deps Dependencies) ([]TermDepositYear, error) {
	content, err := deps.Data.Get(termDepositPath)
	if err != nil {
		if strings.Contains(err.Error(), "NoSuchKey") || strings.Contains(err.Error(), "no such file") {
			return []TermDepositYear{}, nil
		}
		return nil, err
	}
	var years []TermDepositYear
	if err := json.Unmarshal(content, &years); err != nil {
		return nil, err
	}
	return years, nil
}

func TermDepositGet(_ context.Context, _ events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	years, err := loadTermDepositYears(deps)
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}
	body, _ := json.Marshal(years)
	return events.APIGatewayProxyResponse{Body: string(body), StatusCode: 200, Headers: deps.Headers}, nil
}

func TermDepositPost(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	var input []TermDepositYear
	if err := json.Unmarshal([]byte(request.Body), &input); err != nil {
		return events.APIGatewayProxyResponse{Body: `{"error": "Invalid format"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	for i := range input {
		input[i].Balance = roundCurrency(input[i].Balance)
		input[i].Interest = roundCurrency(input[i].Interest)
	}

	content, _ := json.Marshal(input)
	if err := deps.Data.Save(termDepositPath, content); err != nil {
		return errorResponse(err, deps.Headers), nil
	}

	return events.APIGatewayProxyResponse{Body: string(content), StatusCode: 200, Headers: deps.Headers}, nil
}
