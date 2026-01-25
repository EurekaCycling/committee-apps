package endpoints

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/eureka-cycling/committee-apps/backend/internal/storage"
)

type mockStorage struct {
	files map[string][]byte
}

func (m mockStorage) List(path string) ([]storage.FileItem, error) {
	items := []storage.FileItem{}
	for filePath := range m.files {
		if !strings.HasPrefix(filePath, path+"/") {
			continue
		}
		name := filePath[strings.LastIndex(filePath, "/")+1:]
		items = append(items, storage.FileItem{
			Name:    name,
			Path:    filePath,
			IsDir:   false,
			Size:    int64(len(m.files[filePath])),
			ModTime: time.Now(),
		})
	}
	return items, nil
}

func (m mockStorage) Get(path string) ([]byte, error) {
	content, ok := m.files[path]
	if !ok {
		return nil, errors.New("no such file")
	}
	return content, nil
}

func (m mockStorage) Save(path string, content []byte) error {
	if m.files == nil {
		m.files = map[string][]byte{}
	}
	m.files[path] = content
	return nil
}

func (m mockStorage) Mkdir(_ string) error {
	return nil
}

func (m mockStorage) Delete(path string) error {
	if _, ok := m.files[path]; !ok {
		return errors.New("no such file")
	}
	delete(m.files, path)
	return nil
}

func TestLedgerGetUsesPreviousClosingBalance(t *testing.T) {
	currentLedger := MonthlyLedger{
		PK:             "LEDGER#BANK#2024-06",
		Month:          "2024-06",
		Type:           "BANK",
		OpeningBalance: 12.5,
		ClosingBalance: 50,
		Transactions:   []Transaction{},
	}
	previousLedger := MonthlyLedger{
		PK:             "LEDGER#BANK#2024-01",
		Month:          "2024-01",
		Type:           "BANK",
		OpeningBalance: 0,
		ClosingBalance: 99,
		Transactions:   []Transaction{},
	}
	currentJSON, err := json.Marshal(currentLedger)
	if err != nil {
		t.Fatalf("marshal current ledger: %v", err)
	}
	previousJSON, err := json.Marshal(previousLedger)
	if err != nil {
		t.Fatalf("marshal previous ledger: %v", err)
	}
	deps := Dependencies{
		Data: mockStorage{files: map[string][]byte{
			"ledger/BANK/2024-06.json": currentJSON,
			"ledger/BANK/2024-01.json": previousJSON,
		}},
		Headers: DefaultHeaders(),
	}

	request := events.APIGatewayProxyRequest{
		QueryStringParameters: map[string]string{
			"type":  "BANK",
			"month": "2024-06",
		},
	}

	response, err := LedgerGet(context.Background(), request, deps)
	if err != nil {
		t.Fatalf("LedgerGet error: %v", err)
	}
	if response.StatusCode != 200 {
		t.Fatalf("expected status 200, got %d", response.StatusCode)
	}

	var got MonthlyLedger
	if err := json.Unmarshal([]byte(response.Body), &got); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if got.OpeningBalance != previousLedger.ClosingBalance {
		t.Fatalf("expected opening balance %v, got %v", previousLedger.ClosingBalance, got.OpeningBalance)
	}
}
