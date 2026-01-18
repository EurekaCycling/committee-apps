package main

import (
	"context"
	"fmt"
	"net/http" // Standard library http for now, will likely use aws-lambda-go later if needed for specific events, but for API Gateway Proxy "net/http" with adapter is common or just structs. 
    // Actually standard aws lambda go typically uses github.com/aws/aws-lambda-go/lambda
)

// We need the aws-lambda-go library.
// For the Hello World, let's use the standard request/response struct pattern for API Gateway Proxy v2 or v1.

import (
    "github.com/aws/aws-lambda-go/events"
    "github.com/aws/aws-lambda-go/lambda"
)

func handleRequest(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	return events.APIGatewayProxyResponse{Body: "Hello, Eureka Cycling Club!", StatusCode: 200}, nil
}

func main() {
	lambda.Start(handleRequest)
}
