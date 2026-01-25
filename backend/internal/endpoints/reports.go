package endpoints

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
)

type ReportLineItem struct {
	Label  string  `json:"label"`
	Amount float64 `json:"amount"`
}

type ReportNote struct {
	Title   string   `json:"title"`
	Details []string `json:"details"`
}

type StatementSection struct {
	Income           []ReportLineItem `json:"income"`
	Expenditure      []ReportLineItem `json:"expenditure"`
	TotalIncome      float64          `json:"totalIncome"`
	TotalExpenditure float64          `json:"totalExpenditure"`
	NetResult        float64          `json:"netResult"`
}

type BalanceSheetSection struct {
	Assets           []ReportLineItem `json:"assets"`
	Liabilities      []ReportLineItem `json:"liabilities"`
	TotalAssets      float64          `json:"totalAssets"`
	TotalLiabilities float64          `json:"totalLiabilities"`
	Equity           float64          `json:"equity"`
	EquityLabel      string           `json:"equityLabel"`
}

type FinancialReportResponse struct {
	Period       string              `json:"period"`
	Label        string              `json:"label"`
	Range        string              `json:"range"`
	AsAt         string              `json:"asAt"`
	Statement    StatementSection    `json:"statement"`
	BalanceSheet BalanceSheetSection `json:"balanceSheet"`
	Notes        []ReportNote        `json:"notes"`
}

type periodSpec struct {
	Key   string
	Label string
	Start time.Time
	End   time.Time
}

func FinancialReportGet(_ context.Context, request events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	periodKey := request.QueryStringParameters["period"]
	if periodKey == "" {
		periodKey = "ytd"
	}

	spec, err := resolvePeriod(periodKey, time.Now())
	if err != nil {
		return events.APIGatewayProxyResponse{Body: fmt.Sprintf(`{"error": "%s"}`, err.Error()), StatusCode: 400, Headers: deps.Headers}, nil
	}

	ledgersByType, err := loadLedgerData(deps)
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}

	incomeItems, expenseItems, totalIncome, totalExpense := buildStatement(spec.Start, spec.End, ledgersByType)
	netResult := roundCurrency(totalIncome - totalExpense)

	assets, totalAssets := buildAssets(spec.End, ledgersByType)
	liabilities := []ReportLineItem{}
	totalLiabilities := 0.0
	equity := roundCurrency(totalAssets - totalLiabilities)

	notes := buildNotes(assets)

	response := FinancialReportResponse{
		Period: spec.Key,
		Label:  spec.Label,
		Range:  fmt.Sprintf("%s - %s", formatDate(spec.Start), formatDate(spec.End)),
		AsAt:   fmt.Sprintf("As at %s", formatDate(spec.End)),
		Statement: StatementSection{
			Income:           incomeItems,
			Expenditure:      expenseItems,
			TotalIncome:      totalIncome,
			TotalExpenditure: totalExpense,
			NetResult:        netResult,
		},
		BalanceSheet: BalanceSheetSection{
			Assets:           assets,
			Liabilities:      liabilities,
			TotalAssets:      totalAssets,
			TotalLiabilities: totalLiabilities,
			Equity:           equity,
			EquityLabel:      "Accumulated funds",
		},
		Notes: notes,
	}

	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{Body: string(body), StatusCode: 200, Headers: deps.Headers}, nil
}

func resolvePeriod(key string, now time.Time) (periodSpec, error) {
	currentFYEnd := currentFinancialYearEnd(now)

	switch key {
	case "ytd":
		start := time.Date(currentFYEnd-1, time.July, 1, 0, 0, 0, 0, time.UTC)
		end := now
		return periodSpec{Key: key, Label: "Current YTD", Start: start, End: end}, nil
	case "fy-1", "fy-2":
		offset := 1
		if key == "fy-2" {
			offset = 2
		}
		endYear := currentFYEnd - offset
		start := time.Date(endYear-1, time.July, 1, 0, 0, 0, 0, time.UTC)
		end := time.Date(endYear, time.June, 30, 23, 59, 59, 0, time.UTC)
		return periodSpec{Key: key, Label: fmt.Sprintf("FY %d", endYear), Start: start, End: end}, nil
	default:
		return periodSpec{}, fmt.Errorf("Invalid period")
	}
}

func currentFinancialYearEnd(now time.Time) int {
	if now.Month() >= time.July {
		return now.Year() + 1
	}
	return now.Year()
}

func loadLedgerData(deps Dependencies) (map[string][]MonthlyLedger, error) {
	ledgerRootItems, err := deps.Data.List("ledger")
	if err != nil {
		return nil, err
	}

	ledgersByType := make(map[string][]MonthlyLedger)
	for _, item := range ledgerRootItems {
		if !item.IsDir {
			continue
		}
		ledgerType := strings.TrimSuffix(item.Name, "/")
		if ledgerType == "" {
			continue
		}

		files, err := deps.Data.List(fmt.Sprintf("ledger/%s", ledgerType))
		if err != nil {
			return nil, err
		}
		for _, file := range files {
			if file.IsDir || !strings.HasSuffix(file.Name, ".json") {
				continue
			}
			content, err := deps.Data.Get(file.Path)
			if err != nil {
				return nil, err
			}
			var ledger MonthlyLedger
			if err := json.Unmarshal(content, &ledger); err != nil {
				return nil, err
			}
			ledgersByType[ledgerType] = append(ledgersByType[ledgerType], ledger)
		}
	}
	return ledgersByType, nil
}

func buildStatement(start, end time.Time, ledgersByType map[string][]MonthlyLedger) ([]ReportLineItem, []ReportLineItem, float64, float64) {
	incomeTotals := map[string]float64{}
	expenseTotals := map[string]float64{}

	for _, ledgers := range ledgersByType {
		for _, ledger := range ledgers {
			for _, tx := range ledger.Transactions {
				txDate, ok := parseTransactionDate(tx.Date)
				if !ok || txDate.Before(start) || txDate.After(end) {
					continue
				}
				category := strings.TrimSpace(tx.Category)
				if category == "" {
					category = "Uncategorised"
				}
				if tx.Amount >= 0 {
					incomeTotals[category] = roundCurrency(incomeTotals[category] + tx.Amount)
				} else {
					expenseTotals[category] = roundCurrency(expenseTotals[category] + -tx.Amount)
				}
			}
		}
	}

	incomeItems := mapTotalsToItems(incomeTotals)
	expenseItems := mapTotalsToItems(expenseTotals)

	totalIncome := sumTotals(incomeItems)
	totalExpense := sumTotals(expenseItems)
	return incomeItems, expenseItems, totalIncome, totalExpense
}

func buildAssets(end time.Time, ledgersByType map[string][]MonthlyLedger) ([]ReportLineItem, float64) {
	assetLabels := map[string]string{
		"BANK": "Bank account",
		"CASH": "Cash on hand",
		"CARD": "Card balance",
	}
	assets := []ReportLineItem{}

	for ledgerType, ledgers := range ledgersByType {
		balance, ok := ledgerBalanceAsAt(ledgers, end)
		if !ok {
			continue
		}
		label := assetLabels[ledgerType]
		if label == "" {
			label = fmt.Sprintf("%s ledger", ledgerType)
		}
		assets = append(assets, ReportLineItem{Label: label, Amount: balance})
	}

	sort.Slice(assets, func(i, j int) bool {
		return assets[i].Label < assets[j].Label
	})

	totalAssets := sumTotals(assets)
	return assets, totalAssets
}

func ledgerBalanceAsAt(ledgers []MonthlyLedger, end time.Time) (float64, bool) {
	if len(ledgers) == 0 {
		return 0, false
	}

	valid := make([]MonthlyLedger, 0, len(ledgers))
	for _, ledger := range ledgers {
		monthTime, ok := parseLedgerMonth(ledger.Month)
		if !ok || monthTime.After(end) {
			continue
		}
		valid = append(valid, ledger)
	}
	if len(valid) == 0 {
		return 0, false
	}

	sort.Slice(valid, func(i, j int) bool {
		return valid[i].Month < valid[j].Month
	})

	balance := valid[0].OpeningBalance
	for _, ledger := range valid {
		for _, tx := range ledger.Transactions {
			txDate, ok := parseTransactionDate(tx.Date)
			if !ok || txDate.After(end) {
				continue
			}
			balance = roundCurrency(balance + tx.Amount)
		}
	}
	return balance, true
}

func parseLedgerMonth(month string) (time.Time, bool) {
	parsed, err := time.Parse("2006-01", month)
	if err != nil {
		return time.Time{}, false
	}
	return parsed, true
}

func parseTransactionDate(date string) (time.Time, bool) {
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil {
		return time.Time{}, false
	}
	return parsed, true
}

func mapTotalsToItems(totals map[string]float64) []ReportLineItem {
	items := make([]ReportLineItem, 0, len(totals))
	for label, amount := range totals {
		items = append(items, ReportLineItem{Label: label, Amount: roundCurrency(amount)})
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].Label < items[j].Label
	})
	return items
}

func sumTotals(items []ReportLineItem) float64 {
	total := 0.0
	for _, item := range items {
		total = roundCurrency(total + item.Amount)
	}
	return total
}

func buildNotes(assets []ReportLineItem) []ReportNote {
	details := []string{}
	if len(assets) == 0 {
		details = append(details, "No ledger balances available for the period.")
	} else {
		for _, asset := range assets {
			details = append(details, fmt.Sprintf("%s: %s", asset.Label, formatCurrency(asset.Amount)))
		}
		details = append(details, "Balances derived from ledger transactions.")
	}

	return []ReportNote{
		{
			Title:   "Bank accounts",
			Details: details,
		},
		{
			Title:   "Grants",
			Details: []string{"Not available from ledgers; requires separate grant register."},
		},
		{
			Title:   "Loans",
			Details: []string{"Not available from ledgers; requires loan schedule data."},
		},
		{
			Title:   "Trust money",
			Details: []string{"Not available from ledgers; requires trust money ledger."},
		},
	}
}

func formatDate(value time.Time) string {
	return value.Format("2 Jan 2006")
}

func formatCurrency(value float64) string {
	return fmt.Sprintf("$%.2f", value)
}
