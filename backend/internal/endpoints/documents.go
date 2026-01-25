package endpoints

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/eureka-cycling/committee-apps/backend/internal/auth"
	"github.com/eureka-cycling/committee-apps/backend/internal/storage"
)

type DocumentItem struct {
	storage.FileItem
	Token   string `json:"token,omitempty"`
	Expires int64  `json:"expires,omitempty"`
}

func DocumentsList(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	path := request.QueryStringParameters["path"]
	items, err := deps.Storage.List(path)
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}

	enrichedItems := make([]DocumentItem, len(items))
	expires := time.Now().Add(24 * time.Hour).Unix()
	for i, item := range items {
		enrichedItems[i] = DocumentItem{FileItem: item}
		if !item.IsDir {
			enrichedItems[i].Token = auth.GenerateToken(item.Path, expires, deps.SigningSecret)
			enrichedItems[i].Expires = expires
		}
	}

	body, _ := json.Marshal(enrichedItems)
	return events.APIGatewayProxyResponse{Body: string(body), StatusCode: 200, Headers: deps.Headers}, nil
}

func DocumentsRaw(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	path := request.QueryStringParameters["path"]
	token := request.QueryStringParameters["token"]
	expiresStr := request.QueryStringParameters["expires"]

	var expires int64
	fmt.Sscanf(expiresStr, "%d", &expires)

	if !auth.VerifyToken(path, expires, token, deps.SigningSecret) {
		return events.APIGatewayProxyResponse{Body: `{"error": "Unauthorized"}`, StatusCode: 401, Headers: deps.Headers}, nil
	}

	if time.Now().Unix() > expires {
		return events.APIGatewayProxyResponse{Body: `{"error": "Expired"}`, StatusCode: 401, Headers: deps.Headers}, nil
	}

	content, err := deps.Storage.Get(path)
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}

	return events.APIGatewayProxyResponse{
		Body:            base64.StdEncoding.EncodeToString(content),
		IsBase64Encoded: true,
		StatusCode:      200,
		Headers: map[string]string{
			"Access-Control-Allow-Origin": "*",
			"Content-Type":                getMimeType(path),
		},
	}, nil
}

func DocumentsView(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	path := request.QueryStringParameters["path"]
	content, err := deps.Storage.Get(path)
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}
	return events.APIGatewayProxyResponse{
		Body:            base64.StdEncoding.EncodeToString(content),
		IsBase64Encoded: true,
		StatusCode:      200,
		Headers: map[string]string{
			"Access-Control-Allow-Origin": "*",
			"Content-Type":                getMimeType(path),
		},
	}, nil
}

func DocumentsSave(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	if request.HTTPMethod != "POST" {
		return events.APIGatewayProxyResponse{StatusCode: 405, Headers: deps.Headers}, nil
	}
	path := request.QueryStringParameters["path"]
	err := deps.Storage.Save(path, []byte(request.Body))
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}
	return events.APIGatewayProxyResponse{Body: `{"status":"ok"}`, StatusCode: 200, Headers: deps.Headers}, nil
}

func DocumentsUpload(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	if request.HTTPMethod != "POST" {
		return events.APIGatewayProxyResponse{StatusCode: 405, Headers: deps.Headers}, nil
	}
	path := request.QueryStringParameters["path"]
	var body []byte
	var err error
	if request.IsBase64Encoded {
		body, err = base64.StdEncoding.DecodeString(request.Body)
		if err != nil {
			return errorResponse(err, deps.Headers), nil
		}
	} else {
		body = []byte(request.Body)
	}

	err = deps.Storage.Save(path, body)
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}
	return events.APIGatewayProxyResponse{Body: `{"status":"ok"}`, StatusCode: 200, Headers: deps.Headers}, nil
}

func DocumentsMkdir(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	if request.HTTPMethod != "POST" {
		return events.APIGatewayProxyResponse{StatusCode: 405, Headers: deps.Headers}, nil
	}
	path := request.QueryStringParameters["path"]
	err := deps.Storage.Mkdir(path)
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}
	return events.APIGatewayProxyResponse{Body: `{"status":"ok"}`, StatusCode: 200, Headers: deps.Headers}, nil
}
