package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/eureka-cycling/committee-apps/backend/internal/auth"
	"github.com/eureka-cycling/committee-apps/backend/internal/storage"
)

var storageProv storage.StorageProvider
var signingSecret string

func init() {
	signingSecret = os.Getenv("DOCUMENTS_SIGNING_SECRET")
	if signingSecret == "" {
		signingSecret = "default-development-secret"
	}
	bucketName := os.Getenv("DOCUMENTS_BUCKET_NAME")
	if bucketName != "" {
		prov, err := storage.NewS3StorageProvider(context.Background(), bucketName)
		if err != nil {
			panic(err)
		}
		storageProv = prov
	} else {
		prov, err := storage.NewLocalStorageProvider("./data/documents")
		if err != nil {
			panic(err)
		}
		storageProv = prov
	}
}

func handleRequest(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	headers := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
		"Content-Type":                 "application/json",
	}

	switch request.Resource {
	case "/hello":
		return events.APIGatewayProxyResponse{
			Body:       `{"message": "Hello, Eureka Cycling Club!"}`,
			StatusCode: 200,
			Headers:    headers,
		}, nil

	case "/documents/list":
		path := request.QueryStringParameters["path"]
		items, err := storageProv.List(path, signingSecret)
		if err != nil {
			return errorResponse(err, headers), nil
		}
		body, _ := json.Marshal(items)
		return events.APIGatewayProxyResponse{Body: string(body), StatusCode: 200, Headers: headers}, nil

	case "/documents/raw":
		path := request.QueryStringParameters["path"]
		token := request.QueryStringParameters["token"]
		expiresStr := request.QueryStringParameters["expires"]

		var expires int64
		fmt.Sscanf(expiresStr, "%d", &expires)

		if !auth.VerifyToken(path, expires, token, signingSecret) {
			return events.APIGatewayProxyResponse{Body: `{"error": "Unauthorized"}`, StatusCode: 401, Headers: headers}, nil
		}

		if time.Now().Unix() > expires {
			return events.APIGatewayProxyResponse{Body: `{"error": "Expired"}`, StatusCode: 401, Headers: headers}, nil
		}

		content, err := storageProv.Get(path)
		if err != nil {
			return errorResponse(err, headers), nil
		}

		return events.APIGatewayProxyResponse{
			Body:            base64.StdEncoding.EncodeToString(content),
			IsBase64Encoded: true,
			StatusCode:      200,
			Headers: map[string]string{
				"Access-Control-Allow-Origin": "*",
				"Content-Type":                "application/octet-stream",
			},
		}, nil

	case "/documents/view":
		path := request.QueryStringParameters["path"]
		content, err := storageProv.Get(path)
		if err != nil {
			return errorResponse(err, headers), nil
		}
		return events.APIGatewayProxyResponse{
			Body:            base64.StdEncoding.EncodeToString(content),
			IsBase64Encoded: true,
			StatusCode:      200,
			Headers: map[string]string{
				"Access-Control-Allow-Origin": "*",
				"Content-Type":                "application/octet-stream",
			},
		}, nil

	case "/documents/save":
		if request.HTTPMethod != "POST" {
			return events.APIGatewayProxyResponse{StatusCode: 405, Headers: headers}, nil
		}
		path := request.QueryStringParameters["path"]
		err := storageProv.Save(path, []byte(request.Body))
		if err != nil {
			return errorResponse(err, headers), nil
		}
		return events.APIGatewayProxyResponse{Body: `{"status":"ok"}`, StatusCode: 200, Headers: headers}, nil

	case "/documents/upload":
		if request.HTTPMethod != "POST" {
			return events.APIGatewayProxyResponse{StatusCode: 405, Headers: headers}, nil
		}
		path := request.QueryStringParameters["path"]
		var body []byte
		var err error
		if request.IsBase64Encoded {
			body, err = base64.StdEncoding.DecodeString(request.Body)
			if err != nil {
				return errorResponse(err, headers), nil
			}
		} else {
			body = []byte(request.Body)
		}

		err = storageProv.Save(path, body)
		if err != nil {
			return errorResponse(err, headers), nil
		}
		return events.APIGatewayProxyResponse{Body: `{"status":"ok"}`, StatusCode: 200, Headers: headers}, nil

	case "/documents/mkdir":
		if request.HTTPMethod != "POST" {
			return events.APIGatewayProxyResponse{StatusCode: 405, Headers: headers}, nil
		}
		path := request.QueryStringParameters["path"]
		err := storageProv.Mkdir(path)
		if err != nil {
			return errorResponse(err, headers), nil
		}
		return events.APIGatewayProxyResponse{Body: `{"status":"ok"}`, StatusCode: 200, Headers: headers}, nil

	default:
		return events.APIGatewayProxyResponse{
			Body:       `{"error": "Not Found"}`,
			StatusCode: 404,
			Headers:    headers,
		}, nil
	}
}

func errorResponse(err error, headers map[string]string) events.APIGatewayProxyResponse {
	return events.APIGatewayProxyResponse{
		Body:       `{"error": "` + err.Error() + `"}`,
		StatusCode: 500,
		Headers:    headers,
	}
}

func main() {
	lambda.Start(handleRequest)
}
