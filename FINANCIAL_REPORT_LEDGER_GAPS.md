# Financial Report Data Gaps

The financial reports API derives figures directly from ledger transactions. The items below are not available from ledgers alone and require separate data sources or manual input.

## Items not generated from ledgers

- Grants: approvals, acquittals, and receivable schedules require a grant register.
- Loans: balances, interest, and repayment schedules require a loan schedule.
- Trust money: restricted funds held on behalf of others require a trust ledger.
- Bank account metadata: account names, bank details, and reconciled statement references are not in ledgers.
- Non-cash balances: accruals, prepaid expenses, and depreciation are not captured unless explicitly recorded as ledger transactions.

## Current assumptions in reports

- Statement of Income & Expenditure uses transaction signs to classify income (positive) and expenditure (negative).
- Balance Sheet assets are derived from ledger balances as at the period end.
- Liabilities are not derived from ledgers and default to zero.
