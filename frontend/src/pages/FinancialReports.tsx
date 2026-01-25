import { useMemo, useState } from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import './FinancialReports.css';

type PeriodKey = 'ytd' | 'fy2025' | 'fy2024';

type LineItem = {
    label: string;
    amount: number;
    meta?: string;
};

type ReportData = {
    label: string;
    range: string;
    asAt: string;
    statement: {
        income: LineItem[];
        expenditure: LineItem[];
    };
    balanceSheet: {
        assets: LineItem[];
        liabilities: LineItem[];
        equityLabel: string;
    };
    notes: {
        title: string;
        details: string[];
    }[];
};

const periodOptions: { key: PeriodKey; label: string }[] = [
    { key: 'ytd', label: 'Current YTD' },
    { key: 'fy2025', label: 'FY 2025' },
    { key: 'fy2024', label: 'FY 2024' },
];

const reportData: Record<PeriodKey, ReportData> = {
    ytd: {
        label: 'Current YTD',
        range: '1 Jul 2025 - 25 Jan 2026',
        asAt: 'As at 25 Jan 2026',
        statement: {
            income: [
                { label: 'General grants', amount: 84250, meta: 'State & council funding' },
                { label: 'Membership fees', amount: 18740, meta: 'Annual subscriptions' },
                { label: 'Fundraising events', amount: 12630, meta: 'Winter gala' },
                { label: 'Donations & sponsorships', amount: 9500 },
                { label: 'Interest income', amount: 1120 },
            ],
            expenditure: [
                { label: 'Program delivery', amount: 46280, meta: 'Workshops & outreach' },
                { label: 'Staffing & contractors', amount: 29890 },
                { label: 'Facilities & utilities', amount: 14320 },
                { label: 'Equipment & supplies', amount: 6120 },
                { label: 'Insurance & compliance', amount: 3820 },
                { label: 'Administration', amount: 2950 },
            ],
        },
        balanceSheet: {
            assets: [
                { label: 'Operating bank account', amount: 51240 },
                { label: 'Savings reserve', amount: 74000 },
                { label: 'Grant receivables', amount: 18500 },
                { label: 'Prepaid insurance', amount: 3200 },
                { label: 'Equipment (net)', amount: 21400 },
            ],
            liabilities: [
                { label: 'Accounts payable', amount: 11860 },
                { label: 'Accrued payroll', amount: 7200 },
                { label: 'Loan balance', amount: 18500 },
                { label: 'Trust money held', amount: 9600 },
            ],
            equityLabel: 'Accumulated funds',
        },
        notes: [
            {
                title: 'Bank accounts',
                details: [
                    'Operating account: $51.2k (day-to-day cash)',
                    'Savings reserve: $74.0k (board-approved buffer)',
                    'All accounts reconciled to 31 Dec 2025 statement',
                ],
            },
            {
                title: 'Grants',
                details: [
                    'State community grant: $60.0k approved, $45.0k received',
                    'Council activation grant: $25.0k received in Sep 2025',
                    'Grant receivables relate to milestones due Mar 2026',
                ],
            },
            {
                title: 'Loans',
                details: [
                    'Community facility upgrade loan: $18.5k outstanding',
                    'Fixed repayment $1.8k per quarter, next due Feb 2026',
                ],
            },
            {
                title: 'Trust money',
                details: [
                    'Funds held for youth program partners: $9.6k',
                    'Restricted use, acquitted quarterly',
                ],
            },
        ],
    },
    fy2025: {
        label: 'FY 2025',
        range: '1 Jul 2024 - 30 Jun 2025',
        asAt: 'As at 30 Jun 2025',
        statement: {
            income: [
                { label: 'General grants', amount: 158900, meta: 'Multi-year funding' },
                { label: 'Membership fees', amount: 32450 },
                { label: 'Fundraising events', amount: 28900 },
                { label: 'Donations & sponsorships', amount: 17120 },
                { label: 'Interest income', amount: 2040 },
            ],
            expenditure: [
                { label: 'Program delivery', amount: 92840 },
                { label: 'Staffing & contractors', amount: 61200 },
                { label: 'Facilities & utilities', amount: 28600 },
                { label: 'Equipment & supplies', amount: 11290 },
                { label: 'Insurance & compliance', amount: 7460 },
                { label: 'Administration', amount: 5580 },
            ],
        },
        balanceSheet: {
            assets: [
                { label: 'Operating bank account', amount: 46820 },
                { label: 'Savings reserve', amount: 69000 },
                { label: 'Grant receivables', amount: 24200 },
                { label: 'Prepaid insurance', amount: 3500 },
                { label: 'Equipment (net)', amount: 24600 },
            ],
            liabilities: [
                { label: 'Accounts payable', amount: 13940 },
                { label: 'Accrued payroll', amount: 8120 },
                { label: 'Loan balance', amount: 23600 },
                { label: 'Trust money held', amount: 10400 },
            ],
            equityLabel: 'Accumulated funds',
        },
        notes: [
            {
                title: 'Bank accounts',
                details: [
                    'Operating account: $46.8k',
                    'Savings reserve: $69.0k',
                    'Closing cash supported by annual surplus',
                ],
            },
            {
                title: 'Grants',
                details: [
                    'Two-year community grant extended to Jun 2026',
                    'Grant acquittals submitted Oct 2025',
                ],
            },
            {
                title: 'Loans',
                details: [
                    'Facility upgrade loan refinanced May 2025',
                    'Interest rate fixed at 4.8%',
                ],
            },
            {
                title: 'Trust money',
                details: [
                    'Held on behalf of partner co-op: $10.4k',
                    'Fully matched to restricted bank account',
                ],
            },
        ],
    },
    fy2024: {
        label: 'FY 2024',
        range: '1 Jul 2023 - 30 Jun 2024',
        asAt: 'As at 30 Jun 2024',
        statement: {
            income: [
                { label: 'General grants', amount: 143200 },
                { label: 'Membership fees', amount: 29800 },
                { label: 'Fundraising events', amount: 24100 },
                { label: 'Donations & sponsorships', amount: 13920 },
                { label: 'Interest income', amount: 1820 },
            ],
            expenditure: [
                { label: 'Program delivery', amount: 87640 },
                { label: 'Staffing & contractors', amount: 58600 },
                { label: 'Facilities & utilities', amount: 27120 },
                { label: 'Equipment & supplies', amount: 10320 },
                { label: 'Insurance & compliance', amount: 7010 },
                { label: 'Administration', amount: 5210 },
            ],
        },
        balanceSheet: {
            assets: [
                { label: 'Operating bank account', amount: 40210 },
                { label: 'Savings reserve', amount: 62000 },
                { label: 'Grant receivables', amount: 19800 },
                { label: 'Prepaid insurance', amount: 2900 },
                { label: 'Equipment (net)', amount: 26000 },
            ],
            liabilities: [
                { label: 'Accounts payable', amount: 12180 },
                { label: 'Accrued payroll', amount: 6940 },
                { label: 'Loan balance', amount: 28200 },
                { label: 'Trust money held', amount: 8400 },
            ],
            equityLabel: 'Accumulated funds',
        },
        notes: [
            {
                title: 'Bank accounts',
                details: [
                    'Operating account: $40.2k',
                    'Savings reserve: $62.0k',
                    'Cash uplift aligned to grant timing',
                ],
            },
            {
                title: 'Grants',
                details: [
                    'Community resilience grant commenced Aug 2023',
                    'Milestone receipts completed Apr 2024',
                ],
            },
            {
                title: 'Loans',
                details: [
                    'Facility upgrade loan commenced Feb 2024',
                    'Principal repayments began Jul 2024',
                ],
            },
            {
                title: 'Trust money',
                details: [
                    'Funds held for youth program partners: $8.4k',
                    'Restricted to participant disbursements',
                ],
            },
        ],
    },
};

export function FinancialReports() {
    usePageTitle('Financial Reports');
    const [period, setPeriod] = useState<PeriodKey>('ytd');
    const formatter = useMemo(
        () => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }),
        []
    );
    const activeReport = reportData[period];

    const totalIncome = activeReport.statement.income.reduce((sum, item) => sum + item.amount, 0);
    const totalExpenditure = activeReport.statement.expenditure.reduce((sum, item) => sum + item.amount, 0);
    const netResult = totalIncome - totalExpenditure;

    const totalAssets = activeReport.balanceSheet.assets.reduce((sum, item) => sum + item.amount, 0);
    const totalLiabilities = activeReport.balanceSheet.liabilities.reduce((sum, item) => sum + item.amount, 0);
    const totalEquity = totalAssets - totalLiabilities;
    const netResultLabel = netResult >= 0 ? 'Net surplus' : 'Net deficit';

    return (
        <div className="page-container reports-page">
            <div className="reports-shell">
                <header className="reports-hero">
                    <div>
                        <p className="reports-kicker">Finance Snapshot</p>
                        <h1>Financial Reports</h1>
                        <p className="reports-subtitle">
                            Statement of Income &amp; Expenditure, Balance Sheet, and key notes for {activeReport.label}.
                        </p>
                    </div>
                    <div className="reports-metrics">
                        <div className="metric-card">
                            <span className="metric-label">{netResultLabel}</span>
                            <strong className={netResult >= 0 ? 'metric-value positive' : 'metric-value negative'}>
                                {formatter.format(Math.abs(netResult))}
                            </strong>
                            <span className="metric-meta">{activeReport.range}</span>
                        </div>
                        <div className="metric-card">
                            <span className="metric-label">Total assets</span>
                            <strong className="metric-value">{formatter.format(totalAssets)}</strong>
                            <span className="metric-meta">{activeReport.asAt}</span>
                        </div>
                    </div>
                </header>

                <section className="reports-controls">
                    <div className="control-label">
                        <span>Reporting period</span>
                        <span className="control-hint">Default: current YTD</span>
                    </div>
                    <div className="period-toggle" role="tablist" aria-label="Reporting period">
                        {periodOptions.map((option) => (
                            <button
                                key={option.key}
                                type="button"
                                className={`period-pill${period === option.key ? ' active' : ''}`}
                                onClick={() => setPeriod(option.key)}
                                role="tab"
                                aria-selected={period === option.key}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    <div className="period-summary">
                        <span>{activeReport.range}</span>
                        <span>{activeReport.asAt}</span>
                    </div>
                </section>

                <section className="reports-grid">
                    <article className="report-panel">
                        <div className="panel-header">
                            <h2>Statement of Income &amp; Expenditure</h2>
                            <span className="panel-meta">Profit &amp; Loss</span>
                        </div>
                        <div className="report-section">
                            <h3>Income</h3>
                            <div className="report-table">
                                {activeReport.statement.income.map((item) => (
                                    <div className="report-row" key={item.label}>
                                        <div>
                                            <span className="row-label">{item.label}</span>
                                            {item.meta && <span className="row-meta">{item.meta}</span>}
                                        </div>
                                        <span className="row-value">{formatter.format(item.amount)}</span>
                                    </div>
                                ))}
                                <div className="report-row total">
                                    <span>Total income</span>
                                    <span>{formatter.format(totalIncome)}</span>
                                </div>
                            </div>
                        </div>
                        <div className="report-section">
                            <h3>Expenditure</h3>
                            <div className="report-table">
                                {activeReport.statement.expenditure.map((item) => (
                                    <div className="report-row" key={item.label}>
                                        <div>
                                            <span className="row-label">{item.label}</span>
                                            {item.meta && <span className="row-meta">{item.meta}</span>}
                                        </div>
                                        <span className="row-value">{formatter.format(item.amount)}</span>
                                    </div>
                                ))}
                                <div className="report-row total">
                                    <span>Total expenditure</span>
                                    <span>{formatter.format(totalExpenditure)}</span>
                                </div>
                                <div className="report-row grand">
                                    <span>{netResultLabel}</span>
                                    <span>{formatter.format(Math.abs(netResult))}</span>
                                </div>
                            </div>
                        </div>
                    </article>

                    <article className="report-panel">
                        <div className="panel-header">
                            <h2>Balance Sheet</h2>
                            <span className="panel-meta">Statement of Financial Position</span>
                        </div>
                        <div className="report-section">
                            <h3>Assets</h3>
                            <div className="report-table">
                                {activeReport.balanceSheet.assets.map((item) => (
                                    <div className="report-row" key={item.label}>
                                        <span className="row-label">{item.label}</span>
                                        <span className="row-value">{formatter.format(item.amount)}</span>
                                    </div>
                                ))}
                                <div className="report-row total">
                                    <span>Total assets</span>
                                    <span>{formatter.format(totalAssets)}</span>
                                </div>
                            </div>
                        </div>
                        <div className="report-section">
                            <h3>Liabilities</h3>
                            <div className="report-table">
                                {activeReport.balanceSheet.liabilities.map((item) => (
                                    <div className="report-row" key={item.label}>
                                        <span className="row-label">{item.label}</span>
                                        <span className="row-value">{formatter.format(item.amount)}</span>
                                    </div>
                                ))}
                                <div className="report-row total">
                                    <span>Total liabilities</span>
                                    <span>{formatter.format(totalLiabilities)}</span>
                                </div>
                                <div className="report-row grand">
                                    <span>{activeReport.balanceSheet.equityLabel}</span>
                                    <span>{formatter.format(totalEquity)}</span>
                                </div>
                            </div>
                        </div>
                    </article>
                </section>

                <section className="reports-notes">
                    <div className="panel-header">
                        <h2>Notes</h2>
                        <span className="panel-meta">Key items and explanations</span>
                    </div>
                    <div className="notes-grid">
                        {activeReport.notes.map((note) => (
                            <article key={note.title} className="note-card">
                                <h3>{note.title}</h3>
                                <ul>
                                    {note.details.map((detail) => (
                                        <li key={detail}>{detail}</li>
                                    ))}
                                </ul>
                            </article>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}
