package endpoints

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/eureka-cycling/committee-apps/backend/internal/storage"
)

type memoryStorage struct {
	items map[string][]byte
}

func newMemoryStorage() *memoryStorage {
	return &memoryStorage{items: map[string][]byte{}}
}

func (m *memoryStorage) List(path string) ([]storage.FileItem, error) {
	prefix := strings.TrimSuffix(path, "/")
	if prefix != "" {
		prefix += "/"
	}
	items := []storage.FileItem{}
	seen := map[string]struct{}{}
	for key := range m.items {
		if !strings.HasPrefix(key, prefix) {
			continue
		}
		remainder := strings.TrimPrefix(key, prefix)
		if remainder == "" {
			continue
		}
		name := remainder
		isDir := false
		if strings.Contains(remainder, "/") {
			parts := strings.SplitN(remainder, "/", 2)
			name = parts[0]
			isDir = true
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		itemPath := prefix + name
		if !isDir {
			itemPath = key
		}
		items = append(items, storage.FileItem{
			Name:  name,
			Path:  itemPath,
			IsDir: isDir,
		})
	}
	return items, nil
}

func (m *memoryStorage) Get(path string) ([]byte, error) {
	content, ok := m.items[path]
	if !ok {
		return nil, fmt.Errorf("NoSuchKey")
	}
	return content, nil
}

func (m *memoryStorage) Save(path string, content []byte) error {
	m.items[path] = content
	return nil
}

func (m *memoryStorage) Mkdir(path string) error {
	return nil
}

func (m *memoryStorage) Delete(path string) error {
	delete(m.items, path)
	return nil
}

func TestLedgerImportUpdatesExistingMatches(t *testing.T) {
	store := newMemoryStorage()

	existing := MonthlyLedger{
		PK:             "LEDGER#BANK#2025-01",
		Month:          "2025-01",
		Type:           "BANK",
		OpeningBalance: 100,
		ClosingBalance: 150,
		Transactions: []Transaction{
			{
				ID:             "tx-1",
				Date:           "2025-01-05",
				Category:       "Misc",
				Description:    "Entry fee",
				Amount:         50,
				RunningBalance: 150,
			},
		},
	}
	content, err := json.Marshal(existing)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save("ledger/BANK/2025-01.json", content); err != nil {
		t.Fatal(err)
	}

	csv := strings.Join([]string{
		"05/01/2025,50,Entry fee",
		"10/01/2025,20,Membership fee",
	}, "\n")

	request := events.APIGatewayProxyRequest{
		Body: csv,
		QueryStringParameters: map[string]string{
			"type":           "BANK",
			"currentBalance": "170",
		},
	}
	deps := Dependencies{Data: store, Headers: DefaultHeaders()}

	response, err := LedgerImport(context.Background(), request, deps)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if response.StatusCode != 200 {
		t.Fatalf("expected status 200, got %d: %s", response.StatusCode, response.Body)
	}

	updatedContent, err := store.Get("ledger/BANK/2025-01.json")
	if err != nil {
		t.Fatal(err)
	}

	var updated MonthlyLedger
	if err := json.Unmarshal(updatedContent, &updated); err != nil {
		t.Fatal(err)
	}
	if len(updated.Transactions) != 2 {
		t.Fatalf("expected 2 transactions, got %d", len(updated.Transactions))
	}

	var matched *Transaction
	for i := range updated.Transactions {
		tx := &updated.Transactions[i]
		if tx.Date == "2025-01-05" && tx.Amount == 50 {
			matched = tx
			break
		}
	}
	if matched == nil {
		t.Fatalf("expected matching transaction")
	}
	if matched.ID != "tx-1" {
		t.Fatalf("expected matching ID to be preserved, got %s", matched.ID)
	}
	if matched.Category != "Event Fee" {
		t.Fatalf("expected category to update to Event Fee, got %s", matched.Category)
	}

	for _, tx := range updated.Transactions {
		if tx.Date == "2025-01-10" && tx.Amount == 20 {
			if tx.ID == "" {
				t.Fatalf("expected new transaction to have ID")
			}
			if tx.ID == "tx-1" {
				t.Fatalf("expected new transaction to have unique ID")
			}
		}
	}
}
