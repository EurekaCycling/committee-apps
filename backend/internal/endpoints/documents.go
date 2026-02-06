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
		fmt.Printf("Unauthorized document access: %s\n", path)
		return events.APIGatewayProxyResponse{Body: `{"error": "Unauthorized"}`, StatusCode: 401, Headers: deps.Headers}, nil
	}

	if time.Now().Unix() > expires {
		fmt.Printf("Expired document token: %s\n", path)
		return events.APIGatewayProxyResponse{Body: `{"error": "Expired"}`, StatusCode: 401, Headers: deps.Headers}, nil
	}

	content, err := deps.Storage.Get(path)
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}

	mimeType := getMimeType(path)
	fmt.Printf("DocumentsRaw %s mime=%s size=%d\n%s\n", path, mimeType, len(content), formatHexDump(content, 64))

	return events.APIGatewayProxyResponse{
		Body:            base64.StdEncoding.EncodeToString(content),
		IsBase64Encoded: true,
		StatusCode:      200,
		Headers: map[string]string{
			"Access-Control-Allow-Origin": "*",
			"Content-Type":                mimeType,
		},
	}, nil
}

func formatHexDump(data []byte, limit int) string {
	if limit <= 0 {
		return ""
	}
	if len(data) > limit {
		data = data[:limit]
	}

	const bytesPerLine = 16
	result := ""
	for offset := 0; offset < len(data); offset += bytesPerLine {
		end := offset + bytesPerLine
		if end > len(data) {
			end = len(data)
		}
		line := data[offset:end]
		result += fmt.Sprintf("%08x: ", offset)
		for i := 0; i < bytesPerLine; i++ {
			if i < len(line) {
				result += fmt.Sprintf("%02x ", line[i])
			} else {
				result += "   "
			}
			if i == 7 {
				result += " "
			}
		}
		result += " "
		result += renderAsciiColumn(line)
		if end < len(data) {
			result += "\n"
		}
	}
	return result
}

func renderAsciiColumn(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	result := ""
	for _, b := range data {
		if b >= 32 && b <= 126 {
			result += string(b)
		} else {
			result += "."
		}
	}
	return result
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

func DocumentsUpload(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
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
	path := request.QueryStringParameters["path"]
	err := deps.Storage.Mkdir(path)
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}
	return events.APIGatewayProxyResponse{Body: `{"status":"ok"}`, StatusCode: 200, Headers: deps.Headers}, nil
}
