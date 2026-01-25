package endpoints

import (
	"context"

	"github.com/aws/aws-lambda-go/events"
)

func Hello(_ context.Context, _ events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	return events.APIGatewayProxyResponse{
		Body:       `{"message": "Hello, Eureka Cycling Club!"}`,
		StatusCode: 200,
		Headers:    deps.Headers,
	}, nil
}
