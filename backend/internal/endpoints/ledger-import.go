package endpoints

import (
	"encoding/csv"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"time"
)

type bankImportRow struct {
	OrigIdx        int
	Date           time.Time
	Amount         float64
	Description    string
	Category       string
	Month          string
	DateISO        string
	RunningBalance float64
	ID             string
}

func parseBankImportRows(content string) ([]bankImportRow, error) {
	reader := csv.NewReader(strings.NewReader(content))
	reader.Comma = detectBankImportDelimiter(content)
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true

	rows := make([]bankImportRow, 0)
	lineIdx := 0
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("invalid csv: %w", err)
		}
		if len(record) < 3 {
			lineIdx++
			continue
		}
		dateRaw := strings.TrimSpace(record[0])
		amountRaw := strings.TrimSpace(record[1])
		description := strings.TrimSpace(strings.Join(record[2:], " "))
		if dateRaw == "" && amountRaw == "" && description == "" {
			lineIdx++
			continue
		}
		date, err := time.Parse("02/01/2006", dateRaw)
		if err != nil {
			lineIdx++
			continue
		}
		amount, err := strconv.ParseFloat(normalizeAmountString(amountRaw), 64)
		if err != nil {
			lineIdx++
			continue
		}

		rows = append(rows, bankImportRow{
			OrigIdx:     lineIdx,
			Date:        date,
			Amount:      amount,
			Description: description,
			Category:    categorizeBankImport(description),
		})
		lineIdx++
	}

	if len(rows) == 0 {
		return nil, fmt.Errorf("no transactions found")
	}

	return rows, nil
}

func buildBankImportLedgers(rows []bankImportRow, ledgerType string, currentBalance float64) (map[string]MonthlyLedger, []string, float64, float64, error) {
	chrono := make([]bankImportRow, len(rows))
	copy(chrono, rows)
	sort.Slice(chrono, func(i, j int) bool {
		return chrono[i].OrigIdx > chrono[j].OrigIdx
	})

	totalSum := 0.0
	for _, row := range chrono {
		totalSum += row.Amount
	}
	openingBalance := roundCurrency(currentBalance - totalSum)
	ledgerBalance := openingBalance

	for i := range chrono {
		ledgerBalance = roundCurrency(ledgerBalance + chrono[i].Amount)
		chrono[i].RunningBalance = ledgerBalance
		chrono[i].DateISO = chrono[i].Date.Format("2006-01-02")
		chrono[i].Month = chrono[i].Date.Format("2006-01")
		id, err := newUUID()
		if err != nil {
			return nil, nil, 0, 0, err
		}
		chrono[i].ID = id
		if chrono[i].Category == "" {
			chrono[i].Category = categorizeBankImport(chrono[i].Description)
		}
	}

	monthRows := make(map[string][]bankImportRow)
	for _, row := range chrono {
		monthRows[row.Month] = append(monthRows[row.Month], row)
	}
	months := make([]string, 0, len(monthRows))
	for month := range monthRows {
		months = append(months, month)
	}
	sort.Strings(months)

	ledgers := make(map[string]MonthlyLedger, len(months))
	for _, month := range months {
		rows := monthRows[month]
		sort.Slice(rows, func(i, j int) bool {
			if rows[i].Date.Equal(rows[j].Date) {
				return rows[i].OrigIdx < rows[j].OrigIdx
			}
			return rows[i].Date.Before(rows[j].Date)
		})

		first := rows[0]
		opening := roundCurrency(first.RunningBalance - first.Amount)
		closing := roundCurrency(rows[len(rows)-1].RunningBalance)
		transactions := make([]Transaction, 0, len(rows))
		for _, row := range rows {
			transactions = append(transactions, Transaction{
				ID:             row.ID,
				Date:           row.DateISO,
				Category:       row.Category,
				Description:    row.Description,
				Amount:         roundCurrency(row.Amount),
				RunningBalance: roundCurrency(row.RunningBalance),
			})
		}

		ledgers[month] = MonthlyLedger{
			PK:             fmt.Sprintf("LEDGER#%s#%s", ledgerType, month),
			Month:          month,
			Type:           ledgerType,
			OpeningBalance: opening,
			ClosingBalance: closing,
			Transactions:   transactions,
		}
	}

	return ledgers, months, openingBalance, roundCurrency(currentBalance), nil
}

func sumBankImportAmounts(rows []bankImportRow) float64 {
	total := 0.0
	for _, row := range rows {
		total += row.Amount
	}
	return total
}

func detectBankImportDelimiter(content string) rune {
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		tabs := strings.Count(trimmed, "\t")
		commas := strings.Count(trimmed, ",")
		if tabs == 0 && commas == 0 {
			return '\t'
		}
		if tabs >= commas {
			return '\t'
		}
		return ','
	}
	return ','
}

func normalizeAmountString(value string) string {
	value = strings.ReplaceAll(value, ",", "")
	value = strings.ReplaceAll(value, "$", "")
	return strings.TrimSpace(value)
}

func categorizeBankImport(description string) string {
	value := strings.ToLower(description)
	if strings.Contains(value, "tidyhq") || strings.Contains(value, "auscycling") || strings.Contains(value, "life membership") || strings.Contains(value, "membership fee") || strings.Contains(value, "affiliation") {
		return "Membership"
	}
	if strings.Contains(value, "reimburse") || strings.Contains(value, "reimbursement") {
		return "Reimbursement"
	}
	if strings.Contains(value, "lake health group") || strings.Contains(value, "spons") {
		return "Sponsorship"
	}
	if strings.Contains(value, "troph") || strings.Contains(value, "engraving") || strings.Contains(value, "weed killer") || strings.Contains(value, "star outdoor") || strings.Contains(value, "electrical services") || strings.Contains(value, "asr electrical") || strings.Contains(value, "flowers") {
		return "Equipment"
	}
	if strings.Contains(value, "entryboss") || strings.Contains(value, "square") || strings.Contains(value, "race entry") || strings.Contains(value, "entry") || strings.Contains(value, "permits") || strings.Contains(value, "raffle") {
		return "Event Fee"
	}
	return "Misc"
}
