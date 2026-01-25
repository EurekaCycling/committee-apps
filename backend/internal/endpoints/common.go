package endpoints

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/eureka-cycling/committee-apps/backend/internal/storage"
)

type HandlerFunc func(ctx context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error)

type Dependencies struct {
	Storage       storage.StorageProvider
	Data          storage.StorageProvider
	SigningSecret string
	Headers       map[string]string
}

func DefaultHeaders() map[string]string {
	return map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
		"Content-Type":                 "application/json",
	}
}

func errorResponse(err error, headers map[string]string) events.APIGatewayProxyResponse {
	fmt.Printf("Error: %v\n", err)
	return events.APIGatewayProxyResponse{
		Body:       fmt.Sprintf(`{"error": "%s"}`, err.Error()),
		StatusCode: 500,
		Headers:    headers,
	}
}

func getMimeType(path string) string {
	ext := ""
	lastDot := strings.LastIndex(path, ".")
	if lastDot != -1 {
		ext = strings.ToLower(path[lastDot+1:])
	}

	switch ext {
	case "pdf":
		return "application/pdf"
	case "jpg", "jpeg":
		return "image/jpeg"
	case "png":
		return "image/png"
	case "gif":
		return "image/gif"
	case "webp":
		return "image/webp"
	case "svg":
		return "image/svg+xml"
	case "txt":
		return "text/plain"
	case "html":
		return "text/html"
	case "md":
		return "text/markdown"
	default:
		return "application/octet-stream"
	}
}
