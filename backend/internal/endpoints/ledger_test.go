package endpoints

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/eureka-cycling/committee-apps/backend/internal/storage"
)

func TestLedgerGet(t *testing.T) {
	// Skip in CI
	if os.Getenv("CI") != "" {
		t.Skip("skipping test in CI")
	}

	bucketName := "committeeappsbackendprod-databuckete3889a50-hnlnorx7vzql"
	prov, err := storage.NewS3StorageProvider(context.Background(), bucketName)
	if err != nil {
		t.Fatal(err)
	}
	type args struct {
		in0     context.Context
		request events.APIGatewayProxyRequest
		deps    Dependencies
	}
	tests := []struct {
		name    string
		args    args
		want    events.APIGatewayProxyResponse
		wantErr bool
	}{
		{
			name: "Get 2024-12",
			args: args{
				in0: context.Background(),
				request: events.APIGatewayProxyRequest{
					QueryStringParameters: map[string]string{"month": "2024-12", "type": "CASH"},
				},
				deps: Dependencies{
					Data: prov,
				},
			},
			wantErr: false,
			want:    events.APIGatewayProxyResponse{},
		},
		{
			name: "Get 2025-11",
			args: args{
				in0: context.Background(),
				request: events.APIGatewayProxyRequest{
					QueryStringParameters: map[string]string{"month": "2025-11", "type": "CASH"},
				},
				deps: Dependencies{
					Data: prov,
				},
			},
			wantErr: false,
			want:    events.APIGatewayProxyResponse{},
		},
		{
			name: "Get 2025-12",
			args: args{
				in0: context.Background(),
				request: events.APIGatewayProxyRequest{
					QueryStringParameters: map[string]string{"month": "2025-12", "type": "CASH"},
				},
				deps: Dependencies{
					Data: prov,
				},
			},
			wantErr: false,
			want:    events.APIGatewayProxyResponse{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := LedgerGet(tt.args.in0, tt.args.request, tt.args.deps)
			if (err != nil) != tt.wantErr {
				t.Errorf("LedgerGet() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("LedgerGet() got = %v, want %v", got, tt.want)
				// print json
				js, _ := json.MarshalIndent(got, "", "  ")
				t.Logf("%s", js)
			}
		})
	}
}

func TestAddTransactionToLedger(t *testing.T) {
	categories := []string{"Membership", "Event Fee", "Equipment"}

	makeLedger := func(month string, opening float64, transactions []Transaction) MonthlyLedger {
		closing := opening
		if len(transactions) > 0 {
			closing = transactions[len(transactions)-1].RunningBalance
		}
		return MonthlyLedger{
			PK:             "LEDGER#CASH#" + month,
			Month:          month,
			Type:           "CASH",
			OpeningBalance: opening,
			ClosingBalance: closing,
			Transactions:   transactions,
		}
	}

	baseTransactions := []Transaction{
		{
			ID:             "tx-1",
			Date:           "2025-01-10",
			Category:       "Membership",
			Description:    "Existing",
			Amount:         50.00,
			RunningBalance: 150.00,
		},
	}

	tests := []struct {
		name        string
		ledger      MonthlyLedger
		categories  []string
		input       transactionInput
		wantErr     bool
		errContains string
		validate    func(t *testing.T, ledger *MonthlyLedger, tx *Transaction)
	}{
		{
			name:       "success append newer date",
			ledger:     makeLedger("2025-01", 100.00, baseTransactions),
			categories: categories,
			input: transactionInput{
				Date:        "2025-01-11",
				Category:    "Equipment",
				Description: "Purchase",
				Amount:      25.55,
			},
			validate: func(t *testing.T, ledger *MonthlyLedger, tx *Transaction) {
				if ledger == nil || tx == nil {
					t.Fatalf("expected ledger and tx")
				}
				if len(ledger.Transactions) != 2 {
					t.Fatalf("expected 2 transactions, got %d", len(ledger.Transactions))
				}
				if ledger.ClosingBalance != 175.55 {
					t.Fatalf("expected closing 175.55, got %.2f", ledger.ClosingBalance)
				}
				if tx.RunningBalance != 175.55 {
					t.Fatalf("expected running balance 175.55, got %.2f", tx.RunningBalance)
				}
				if tx.Description != "Purchase" {
					t.Fatalf("expected description to be set")
				}
				if tx.ID == "" {
					t.Fatalf("expected id to be set")
				}
			},
		},
		{
			name:       "success same date as last entry",
			ledger:     makeLedger("2025-01", 100.00, baseTransactions),
			categories: categories,
			input: transactionInput{
				Date:        "2025-01-10",
				Category:    "Membership",
				Description: "Same day",
				Amount:      10.00,
			},
			validate: func(t *testing.T, ledger *MonthlyLedger, tx *Transaction) {
				if ledger.ClosingBalance != 160.00 {
					t.Fatalf("expected closing 160.00, got %.2f", ledger.ClosingBalance)
				}
			},
		},
		{
			name:       "success ledger month empty",
			ledger:     makeLedger("", 20.00, nil),
			categories: categories,
			input: transactionInput{
				Date:        "2025-02-01",
				Category:    "Event Fee",
				Description: "Fee",
				Amount:      5.00,
			},
			validate: func(t *testing.T, ledger *MonthlyLedger, tx *Transaction) {
				if ledger.ClosingBalance != 25.00 {
					t.Fatalf("expected closing 25.00, got %.2f", ledger.ClosingBalance)
				}
			},
		},
		{
			name:       "success zero amount",
			ledger:     makeLedger("2025-01", 100.00, baseTransactions),
			categories: categories,
			input: transactionInput{
				Date:        "2025-01-11",
				Category:    "Equipment",
				Description: "Zero",
				Amount:      0.00,
			},
			validate: func(t *testing.T, ledger *MonthlyLedger, tx *Transaction) {
				if ledger.ClosingBalance != 150.00 {
					t.Fatalf("expected closing 150.00, got %.2f", ledger.ClosingBalance)
				}
			},
		},
		{
			name:        "fail missing category",
			ledger:      makeLedger("2025-01", 100.00, nil),
			categories:  categories,
			input:       transactionInput{Date: "2025-01-01", Amount: 1.00},
			wantErr:     true,
			errContains: "date and category",
		},
		{
			name:        "fail invalid category",
			ledger:      makeLedger("2025-01", 100.00, nil),
			categories:  categories,
			input:       transactionInput{Date: "2025-01-01", Category: "Other", Amount: 1.00},
			wantErr:     true,
			errContains: "category is not valid",
		},
		{
			name:        "fail amount NaN",
			ledger:      makeLedger("2025-01", 100.00, nil),
			categories:  categories,
			input:       transactionInput{Date: "2025-01-01", Category: "Membership", Amount: math.NaN()},
			wantErr:     true,
			errContains: "amount must be a number",
		},
		{
			name:        "fail amount inf",
			ledger:      makeLedger("2025-01", 100.00, nil),
			categories:  categories,
			input:       transactionInput{Date: "2025-01-01", Category: "Membership", Amount: math.Inf(1)},
			wantErr:     true,
			errContains: "amount must be a number",
		},
		{
			name:        "fail amount more than two decimals",
			ledger:      makeLedger("2025-01", 100.00, nil),
			categories:  categories,
			input:       transactionInput{Date: "2025-01-01", Category: "Membership", Amount: 1.001},
			wantErr:     true,
			errContains: "two decimals",
		},
		{
			name:        "fail invalid date format",
			ledger:      makeLedger("2025-01", 100.00, nil),
			categories:  categories,
			input:       transactionInput{Date: "01-01-2025", Category: "Membership", Amount: 1.00},
			wantErr:     true,
			errContains: "YYYY-MM-DD",
		},
		{
			name:        "fail older than last entry",
			ledger:      makeLedger("2025-01", 100.00, baseTransactions),
			categories:  categories,
			input:       transactionInput{Date: "2025-01-09", Category: "Membership", Amount: 1.00},
			wantErr:     true,
			errContains: "older than last entry",
		},
		{
			name:        "fail month mismatch",
			ledger:      makeLedger("2025-01", 100.00, nil),
			categories:  categories,
			input:       transactionInput{Date: "2025-02-01", Category: "Membership", Amount: 1.00},
			wantErr:     true,
			errContains: "match ledger month",
		},
		{
			name:        "fail closing balance zero",
			ledger:      makeLedger("2025-01", 10.00, nil),
			categories:  categories,
			input:       transactionInput{Date: "2025-01-01", Category: "Membership", Amount: -10.00},
			wantErr:     true,
			errContains: "greater than 0",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotLedger, gotTx, err := addTransactionToLedger(tt.ledger, tt.categories, tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("expected error=%v, got err=%v", tt.wantErr, err)
			}
			if tt.wantErr {
				if gotLedger != nil || gotTx != nil {
					t.Fatalf("expected nil ledger and tx on error")
				}
				if tt.errContains != "" && err != nil && !strings.Contains(err.Error(), tt.errContains) {
					t.Fatalf("expected error to contain %q, got %q", tt.errContains, err.Error())
				}
				return
			}

			if tt.validate != nil {
				tt.validate(t, gotLedger, gotTx)
			}
		})
	}
}
