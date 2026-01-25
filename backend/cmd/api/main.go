package main

import (
	"context"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/eureka-cycling/committee-apps/backend/internal/endpoints"
	"github.com/eureka-cycling/committee-apps/backend/internal/storage"
)

var (
	storageProv storage.StorageProvider
	dataProv    storage.StorageProvider
)
var signingSecret string

func init() {
	signingSecret = os.Getenv("DOCUMENTS_SIGNING_SECRET")
	if signingSecret == "" {
		signingSecret = "default-development-secret"
	}
	bucketName := os.Getenv("DOCUMENTS_BUCKET_NAME")
	prov, err := storage.NewS3StorageProvider(context.Background(), bucketName)
	if err != nil {
		panic(err)
	}
	storageProv = prov

	dataBucketName := os.Getenv("DATA_BUCKET_NAME")
	dprov, err := storage.NewS3StorageProvider(context.Background(), dataBucketName)
	if err != nil {
		panic(err)
	}
	dataProv = dprov
}

type route struct {
	handler endpoints.HandlerFunc
}

var routes = map[string]route{
	"/hello":             {handler: endpoints.Hello},
	"/documents/list":    {handler: endpoints.DocumentsList},
	"/documents/raw":     {handler: endpoints.DocumentsRaw},
	"/documents/view":    {handler: endpoints.DocumentsView},
	"/documents/save":    {handler: endpoints.DocumentsSave},
	"/documents/upload":  {handler: endpoints.DocumentsUpload},
	"/documents/mkdir":   {handler: endpoints.DocumentsMkdir},
	"/ledger":            {handler: endpoints.Ledger},
	"/ledger/categories": {handler: endpoints.LedgerCategories},
}

func handleRequest(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	headers := endpoints.DefaultHeaders()
	deps := endpoints.Dependencies{
		Storage:       storageProv,
		Data:          dataProv,
		SigningSecret: signingSecret,
		Headers:       headers,
	}

	route, ok := routes[request.Resource]
	if !ok {
		return events.APIGatewayProxyResponse{
			Body:       `{"error": "Not Found"}`,
			StatusCode: 404,
			Headers:    headers,
		}, nil
	}

	return route.handler(ctx, request, deps)
}

func main() {
	lambda.Start(handleRequest)
}
