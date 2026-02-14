package endpoints

import (
	"context"
	"encoding/base64"
	"encoding/json"
	pathpkg "path"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/eureka-cycling/committee-apps/backend/internal/storage"
)

type DocumentListItem struct {
	storage.FileItem
	URL string `json:"url,omitempty"`
}

func DocumentsList(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	path := request.QueryStringParameters["path"]
	items, err := deps.Storage.List(path)
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}

	responseItems := make([]DocumentListItem, 0, len(items))
	for _, item := range items {
		responseItem := DocumentListItem{FileItem: item}
		if !item.IsDir {
			ext := strings.ToLower(strings.TrimPrefix(pathpkg.Ext(item.Name), "."))
			if ext != "md" {
				url, err := deps.Storage.PresignGet(item.Path, time.Hour)
				if err != nil {
					return errorResponse(err, deps.Headers), nil
				}
				responseItem.URL = url
			}
		}
		responseItems = append(responseItems, responseItem)
	}

	body, _ := json.Marshal(responseItems)
	return events.APIGatewayProxyResponse{Body: string(body), StatusCode: 200, Headers: deps.Headers}, nil
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
	path := request.QueryStringParameters["path"]
	err := deps.Storage.Save(path, []byte(request.Body))
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}
	return events.APIGatewayProxyResponse{Body: `{"status":"ok"}`, StatusCode: 200, Headers: deps.Headers}, nil
}

func DocumentsMkdir(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	path := request.QueryStringParameters["path"]
	err := deps.Storage.Mkdir(path)
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}
	return events.APIGatewayProxyResponse{Body: `{"status":"ok"}`, StatusCode: 200, Headers: deps.Headers}, nil
}
