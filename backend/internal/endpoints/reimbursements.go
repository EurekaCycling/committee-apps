package endpoints

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
)

const reimbursementPrefix = "reimbursement/"

type reimbursementFile struct {
	FileName    string
	ContentType string
	Content     []byte
}

type reimbursementPayloadReceipt struct {
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	Content     string `json:"content"`
}

type reimbursementPayload struct {
	RequestID     string                       `json:"requestId"`
	Category      string                       `json:"category"`
	PurchaseDate  string                       `json:"purchaseDate"`
	Amount        float64                      `json:"amount"`
	Description   string                       `json:"description"`
	MemberMode    string                       `json:"memberMode"`
	MemberSearch  string                       `json:"memberSearch"`
	MemberName    string                       `json:"memberName"`
	MemberEmail   string                       `json:"memberEmail"`
	MemberPhone   string                       `json:"memberPhone"`
	PaymentMethod string                       `json:"paymentMethod"`
	PayID         string                       `json:"payId"`
	BSB           string                       `json:"bsb"`
	AccountNumber string                       `json:"accountNumber"`
	Receipt       *reimbursementPayloadReceipt `json:"receipt"`
}

type ReimbursementReceipt struct {
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
	Path        string `json:"path"`
}

type ReimbursementRequest struct {
	ID            string               `json:"id"`
	Status        string               `json:"status"`
	CreatedAt     string               `json:"createdAt"`
	UpdatedAt     string               `json:"updatedAt"`
	Category      string               `json:"category"`
	Description   string               `json:"description"`
	Amount        float64              `json:"amount"`
	PurchaseDate  string               `json:"purchaseDate"`
	MemberMode    string               `json:"memberMode"`
	MemberSearch  string               `json:"memberSearch,omitempty"`
	MemberName    string               `json:"memberName,omitempty"`
	MemberEmail   string               `json:"memberEmail,omitempty"`
	MemberPhone   string               `json:"memberPhone,omitempty"`
	PaymentMethod string               `json:"paymentMethod,omitempty"`
	PayID         string               `json:"payId,omitempty"`
	BSB           string               `json:"bsb,omitempty"`
	AccountNumber string               `json:"accountNumber,omitempty"`
	Receipt       ReimbursementReceipt `json:"receipt"`
	Reference     string               `json:"reference"`
}

type ReimbursementListItem struct {
	Reference string  `json:"reference"`
	Status    string  `json:"status"`
	Title     string  `json:"title"`
	Amount    float64 `json:"amount"`
	RequestID string  `json:"requestId,omitempty"`
	CreatedAt string  `json:"createdAt,omitempty"`
}

type ReimbursementMember struct {
	Name          string `json:"name"`
	Email         string `json:"email,omitempty"`
	Phone         string `json:"phone,omitempty"`
	PaymentMethod string `json:"paymentMethod,omitempty"`
	PayID         string `json:"payId,omitempty"`
	BSB           string `json:"bsb,omitempty"`
	AccountNumber string `json:"accountNumber,omitempty"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

func ReimbursementsPost(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	contentType := headerValue(request.Headers, "Content-Type")
	var fields map[string]string
	var receipt *reimbursementFile
	var err error

	if strings.HasPrefix(strings.ToLower(contentType), "application/json") {
		fields, receipt, err = parseReimbursementJSON(request)
	} else {
		fields, receipt, err = parseReimbursementForm(request)
	}
	if err != nil {
		fmt.Printf("Invalid reimbursement form - Error: %v\n", err)
		return events.APIGatewayProxyResponse{Body: fmt.Sprintf(`{"error": "%s"}`, err.Error()), StatusCode: 400, Headers: deps.Headers}, nil
	}

	requestID := strings.TrimSpace(fields["requestId"])
	if requestID == "" {
		requestID, err = newUUID()
		if err != nil {
			return errorResponse(err, deps.Headers), nil
		}
	}

	category := strings.TrimSpace(fields["category"])
	if category == "" {
		return events.APIGatewayProxyResponse{Body: `{"error": "Category is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	purchaseDate := strings.TrimSpace(fields["purchaseDate"])
	if purchaseDate == "" {
		return events.APIGatewayProxyResponse{Body: `{"error": "Purchase date is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	parsedDate, err := time.Parse("2006-01-02", purchaseDate)
	if err != nil {
		return events.APIGatewayProxyResponse{Body: `{"error": "Purchase date must be YYYY-MM-DD"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	amountStr := strings.TrimSpace(fields["amount"])
	if amountStr == "" {
		return events.APIGatewayProxyResponse{Body: `{"error": "Amount is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}
	amount, err := strconv.ParseFloat(normalizeAmountString(amountStr), 64)
	if err != nil {
		return events.APIGatewayProxyResponse{Body: `{"error": "Amount must be a number"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}
	if amount <= 0 {
		return events.APIGatewayProxyResponse{Body: `{"error": "Amount must be greater than zero"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	description := strings.TrimSpace(fields["description"])
	if description == "" {
		return events.APIGatewayProxyResponse{Body: `{"error": "Description is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	memberMode := strings.TrimSpace(fields["memberMode"])
	if memberMode == "" {
		return events.APIGatewayProxyResponse{Body: `{"error": "Member mode is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	if receipt == nil || len(receipt.Content) == 0 {
		return events.APIGatewayProxyResponse{Body: `{"error": "Receipt is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	receiptExt, err := resolveReceiptExtension(receipt)
	if err != nil {
		return events.APIGatewayProxyResponse{Body: fmt.Sprintf(`{"error": "%s"}`, err.Error()), StatusCode: 400, Headers: deps.Headers}, nil
	}

	year := parsedDate.Format("2006")
	receiptPath := fmt.Sprintf("%s%s/%s-receipt%s", reimbursementPrefix, year, requestID, receiptExt)
	metadataPath := fmt.Sprintf("%s%s/%s-metadata.json", reimbursementPrefix, year, requestID)
	reference := fmt.Sprintf("%s/%s", year, requestID)

	memberSearch := strings.TrimSpace(fields["memberSearch"])
	memberName := strings.TrimSpace(fields["memberName"])
	memberEmail := strings.TrimSpace(fields["memberEmail"])
	memberPhone := strings.TrimSpace(fields["memberPhone"])
	paymentMethod := strings.TrimSpace(fields["paymentMethod"])
	payID := strings.TrimSpace(fields["payId"])
	bsb := strings.TrimSpace(fields["bsb"])
	accountNumber := strings.TrimSpace(fields["accountNumber"])

	switch memberMode {
	case "existing":
		if memberSearch == "" {
			return events.APIGatewayProxyResponse{Body: `{"error": "Member selection is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
		}
	case "new":
		if memberName == "" {
			return events.APIGatewayProxyResponse{Body: `{"error": "Member name is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
		}
		if paymentMethod == "" {
			return events.APIGatewayProxyResponse{Body: `{"error": "Payment method is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
		}
		switch paymentMethod {
		case "payid":
			if payID == "" {
				return events.APIGatewayProxyResponse{Body: `{"error": "PayID is required"}`, StatusCode: 400, Headers: deps.Headers}, nil
			}
		case "bank":
			if bsb == "" || accountNumber == "" {
				return events.APIGatewayProxyResponse{Body: `{"error": "BSB and account number are required"}`, StatusCode: 400, Headers: deps.Headers}, nil
			}
		default:
			return events.APIGatewayProxyResponse{Body: `{"error": "Payment method must be payid or bank"}`, StatusCode: 400, Headers: deps.Headers}, nil
		}
	default:
		return events.APIGatewayProxyResponse{Body: `{"error": "Member mode must be existing or new"}`, StatusCode: 400, Headers: deps.Headers}, nil
	}

	now := time.Now().UTC().Format(time.RFC3339)
	status := "Pending Approval"
	receiptInfo := ReimbursementReceipt{
		FileName:    receipt.FileName,
		ContentType: receipt.ContentType,
		Size:        int64(len(receipt.Content)),
		Path:        receiptPath,
	}

	reimbursement := ReimbursementRequest{
		ID:            requestID,
		Status:        status,
		CreatedAt:     now,
		UpdatedAt:     now,
		Category:      category,
		Description:   description,
		Amount:        roundCurrency(amount),
		PurchaseDate:  purchaseDate,
		MemberMode:    memberMode,
		MemberSearch:  memberSearch,
		MemberName:    memberName,
		MemberEmail:   memberEmail,
		MemberPhone:   memberPhone,
		PaymentMethod: paymentMethod,
		PayID:         payID,
		BSB:           bsb,
		AccountNumber: accountNumber,
		Receipt:       receiptInfo,
		Reference:     reference,
	}

	if err := deps.Data.Save(receiptPath, receipt.Content); err != nil {
		return errorResponse(err, deps.Headers), nil
	}

	metadataContent, _ := json.Marshal(reimbursement)
	if err := deps.Data.Save(metadataPath, metadataContent); err != nil {
		return errorResponse(err, deps.Headers), nil
	}

	if err := updateReimbursementList(deps, reimbursement); err != nil {
		return errorResponse(err, deps.Headers), nil
	}

	if memberMode == "new" {
		if err := upsertReimbursementMember(deps, ReimbursementMember{
			Name:          memberName,
			Email:         memberEmail,
			Phone:         memberPhone,
			PaymentMethod: paymentMethod,
			PayID:         payID,
			BSB:           bsb,
			AccountNumber: accountNumber,
			CreatedAt:     now,
			UpdatedAt:     now,
		}); err != nil {
			return errorResponse(err, deps.Headers), nil
		}
	}

	body, _ := json.Marshal(reimbursement)
	return events.APIGatewayProxyResponse{Body: string(body), StatusCode: 200, Headers: deps.Headers}, nil
}

func parseReimbursementForm(request events.APIGatewayProxyRequest) (map[string]string, *reimbursementFile, error) {
	contentType := headerValue(request.Headers, "Content-Type")
	if contentType == "" {
		return nil, nil, fmt.Errorf("Content-Type is required")
	}

	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || !strings.HasPrefix(mediaType, "multipart/") {
		return nil, nil, fmt.Errorf("Content-Type must be multipart/form-data")
	}

	boundary := params["boundary"]
	if boundary == "" {
		return nil, nil, fmt.Errorf("Missing multipart boundary")
	}

	var bodyReader io.Reader
	if request.IsBase64Encoded {
		decoded, err := base64.StdEncoding.DecodeString(request.Body)
		if err != nil {
			return nil, nil, err
		}
		bodyReader = bytes.NewReader(decoded)
	} else {
		bodyReader = strings.NewReader(request.Body)
	}

	reader := multipart.NewReader(bodyReader, boundary)
	fields := map[string]string{}
	var receipt *reimbursementFile

	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, nil, err
		}

		name := part.FormName()
		if name == "" {
			continue
		}
		data, err := io.ReadAll(part)
		if err != nil {
			return nil, nil, err
		}

		if fileName := part.FileName(); fileName != "" {
			receipt = &reimbursementFile{
				FileName:    fileName,
				ContentType: part.Header.Get("Content-Type"),
				Content:     data,
			}
			continue
		}

		fields[name] = strings.TrimSpace(string(data))
	}

	return fields, receipt, nil
}

func parseReimbursementJSON(request events.APIGatewayProxyRequest) (map[string]string, *reimbursementFile, error) {
	var body []byte
	if request.IsBase64Encoded {
		decoded, err := base64.StdEncoding.DecodeString(request.Body)
		if err != nil {
			return nil, nil, err
		}
		body = decoded
	} else {
		body = []byte(request.Body)
	}

	var payload reimbursementPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, nil, err
	}

	fields := map[string]string{
		"requestId":     strings.TrimSpace(payload.RequestID),
		"category":      strings.TrimSpace(payload.Category),
		"purchaseDate":  strings.TrimSpace(payload.PurchaseDate),
		"amount":        strconv.FormatFloat(payload.Amount, 'f', -1, 64),
		"description":   strings.TrimSpace(payload.Description),
		"memberMode":    strings.TrimSpace(payload.MemberMode),
		"memberSearch":  strings.TrimSpace(payload.MemberSearch),
		"memberName":    strings.TrimSpace(payload.MemberName),
		"memberEmail":   strings.TrimSpace(payload.MemberEmail),
		"memberPhone":   strings.TrimSpace(payload.MemberPhone),
		"paymentMethod": strings.TrimSpace(payload.PaymentMethod),
		"payId":         strings.TrimSpace(payload.PayID),
		"bsb":           strings.TrimSpace(payload.BSB),
		"accountNumber": strings.TrimSpace(payload.AccountNumber),
	}

	if payload.Receipt == nil {
		return fields, nil, nil
	}
	content := strings.TrimSpace(payload.Receipt.Content)
	if content == "" {
		return fields, nil, nil
	}
	decoded, err := base64.StdEncoding.DecodeString(content)
	if err != nil {
		return nil, nil, err
	}
	return fields, &reimbursementFile{
		FileName:    payload.Receipt.FileName,
		ContentType: payload.Receipt.ContentType,
		Content:     decoded,
	}, nil
}

func resolveReceiptExtension(file *reimbursementFile) (string, error) {
	ext := strings.ToLower(filepath.Ext(file.FileName))
	if ext == "" {
		switch strings.ToLower(file.ContentType) {
		case "application/pdf":
			ext = ".pdf"
		case "image/jpeg":
			ext = ".jpg"
		case "image/png":
			ext = ".png"
		}
	}

	switch ext {
	case ".pdf", ".jpg", ".jpeg", ".png":
		return ext, nil
	default:
		return "", fmt.Errorf("Receipt must be PDF, JPG, or PNG")
	}
}

func updateReimbursementList(deps Dependencies, reimbursement ReimbursementRequest) error {
	path := reimbursementPrefix + "list.json"
	existing, err := deps.Data.Get(path)
	list := []ReimbursementListItem{}
	if err != nil {
		if !isNoSuchKey(err) {
			return err
		}
	} else if err := json.Unmarshal(existing, &list); err != nil {
		return err
	}

	title := buildReimbursementTitle(reimbursement)
	entry := ReimbursementListItem{
		Reference: reimbursement.Reference,
		Status:    reimbursement.Status,
		Title:     title,
		Amount:    reimbursement.Amount,
		RequestID: reimbursement.ID,
		CreatedAt: reimbursement.CreatedAt,
	}

	list = append([]ReimbursementListItem{entry}, list...)
	payload, _ := json.Marshal(list)
	return deps.Data.Save(path, payload)
}

func buildReimbursementTitle(reimbursement ReimbursementRequest) string {
	member := reimbursement.MemberSearch
	if member == "" {
		member = reimbursement.MemberName
	}
	parts := []string{}
	if member != "" {
		parts = append(parts, member)
	}
	if reimbursement.Category != "" {
		parts = append(parts, reimbursement.Category)
	}
	if reimbursement.Description != "" {
		parts = append(parts, reimbursement.Description)
	}
	return strings.TrimSpace(strings.Join(parts, " - "))
}

func upsertReimbursementMember(deps Dependencies, member ReimbursementMember) error {
	path := reimbursementPrefix + "members.json"
	existing, err := deps.Data.Get(path)
	members := []ReimbursementMember{}
	if err != nil {
		if !isNoSuchKey(err) {
			return err
		}
	} else if err := json.Unmarshal(existing, &members); err != nil {
		return err
	}

	index := -1
	for i, existingMember := range members {
		if member.Email != "" && existingMember.Email == member.Email {
			index = i
			break
		}
		if member.Phone != "" && existingMember.Phone == member.Phone {
			index = i
			break
		}
		if member.Name != "" && existingMember.Name == member.Name {
			index = i
			break
		}
	}

	if index >= 0 {
		member.CreatedAt = members[index].CreatedAt
		members[index] = member
	} else if member.Name != "" {
		members = append(members, member)
	}

	payload, _ := json.Marshal(members)
	return deps.Data.Save(path, payload)
}

func headerValue(headers map[string]string, key string) string {
	for headerKey, value := range headers {
		if strings.EqualFold(headerKey, key) {
			return value
		}
	}
	return ""
}

func isNoSuchKey(err error) bool {
	return strings.Contains(err.Error(), "NoSuchKey") || strings.Contains(err.Error(), "no such file")
}
