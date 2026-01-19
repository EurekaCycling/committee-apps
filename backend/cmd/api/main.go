package main

import (
	"context"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

func handleRequest(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	return events.APIGatewayProxyResponse{
		Body:       "Hello, Eureka Cycling Club!",
		StatusCode: 200,
		Headers: map[string]string{
			"Access-Control-Allow-Origin": "https://committee.eurekacycling.org.au",
		},
	}, nil
}

func main() {
	lambda.Start(handleRequest)
}
