package main

import (
	"context"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

func orginList(origins []string) string {
	return strings.Join(origins, ", ")
}

func handleRequest(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {

	origins := []string{
		"https://committee.eurekacycling.org.au",
		"https://committee2.eurekacycling.org.au",
	}

	return events.APIGatewayProxyResponse{
		Body:       "Hello, Eureka Cycling Club!",
		StatusCode: 200,
		Headers: map[string]string{
			"Access-Control-Allow-Origin": orginList(origins),
		},
	}, nil
}

func main() {
	lambda.Start(handleRequest)
}
