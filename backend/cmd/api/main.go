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
	"GET:/hello":               {handler: endpoints.Hello},
	"GET:/documents/list":      {handler: endpoints.DocumentsList},
	"GET:/documents/raw":       {handler: endpoints.DocumentsRaw},
	"GET:/documents/view":      {handler: endpoints.DocumentsView},
	"POST:/documents/save":     {handler: endpoints.DocumentsSave},
	"POST:/documents/upload":   {handler: endpoints.DocumentsUpload},
	"POST:/documents/mkdir":    {handler: endpoints.DocumentsMkdir},
	"GET:/ledger":              {handler: endpoints.LedgerGet},
	"GET:/ledger/pdf":          {handler: endpoints.LedgerPdf},
	"POST:/ledger":             {handler: endpoints.LedgerPost},
	"POST:/ledger/import/back": {handler: endpoints.LedgerBankImport},
	"GET:/ledger/categories":   {handler: endpoints.LedgerCategoriesGet},
	"POST:/ledger/categories":  {handler: endpoints.LedgerCategoriesPost},
	"GET:/reports/financial":   {handler: endpoints.FinancialReportGet},
}

func handleRequest(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	headers := endpoints.DefaultHeaders()
	deps := endpoints.Dependencies{
		Storage:       storageProv,
		Data:          dataProv,
		SigningSecret: signingSecret,
		Headers:       headers,
	}

	key := request.HTTPMethod + ":" + request.Resource
	route, ok := routes[key]
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
