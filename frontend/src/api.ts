import { fetchAuthSession } from 'aws-amplify/auth';
import { fetchAppConfig } from './config';
import { generateMockLedger, CATEGORIES } from './mocks/ledgerData';
import type { MonthlyLedger, TransactionType } from './mocks/ledgerData';

async function resolveApiBaseUrl() {
    const config = await fetchAppConfig();
    return config.apiBaseUrl;
}

export async function apiFetch(path: string, options: RequestInit = {}) {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();

    const headers = new Headers(options.headers);
    if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    const baseUrl = await resolveApiBaseUrl();
    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers,
    });

    // Centralised error handling
    if (!response.ok) {
        // Attempt to extract error details from the response body
        let errorMsg = `${response.status} ${response.statusText}`;
        try {
            const errData = await response.json();
            if (errData && errData.message) {
                errorMsg = errData.message;
            }
        } catch (_) {
            // ignore JSON parse errors
        }
        throw new Error(`API request failed: ${errorMsg}`);
    }

    return response;
}

export async function fetchLedger(type: TransactionType): Promise<MonthlyLedger[]> {
    if (import.meta.env.VITE_NO_AUTH === 'true') {
        console.log(`Mocking Ledger Fetch for ${type}`);
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 500));
        return generateMockLedger(type);
    }

    const res = await apiFetch(`/ledger?type=${type}`);
    // apiFetch already throws on non‑OK responses, so we can directly parse JSON
    const data = await res.json();
    // Guard against unexpected null/undefined
    if (!data) {
        throw new Error('Ledger response was empty');
    }
    return data as MonthlyLedger[];
}

export async function saveLedger(type: TransactionType, ledger: MonthlyLedger[]): Promise<void> {
    if (import.meta.env.VITE_NO_AUTH === 'true') {
        console.log(`Mocking Ledger Save for ${type}`, ledger);
        return;
    }

    const res = await apiFetch(`/ledger?type=${type}`, {
        method: 'POST',
        body: JSON.stringify(ledger),
    });
    // apiFetch throws on error, so just ensure response is consumed
    await res.text(); // consume body
}

export async function fetchCategories(): Promise<string[]> {
    if (import.meta.env.VITE_NO_AUTH === 'true') {
        return CATEGORIES;
    }

    const res = await apiFetch(`/ledger/categories`);
    const data = await res.json();
    if (!data) {
        throw new Error('Categories response was empty');
    }
    return data as string[];
}

export async function saveCategories(categories: string[]): Promise<void> {
    if (import.meta.env.VITE_NO_AUTH === 'true') {
        console.log('Mocking Categories Save', categories);
        return;
    }

    const res = await apiFetch(`/ledger/categories`, {
        method: 'POST',
        body: JSON.stringify(categories),
    });
    // apiFetch will throw on error; consume response
    await res.text();
}

export type LedgerTransactionInput = {
    date: string;
    category: string;
    description: string;
    amount: number;
};

export type LedgerTransactionEditInput = {
    month: string;
    type: TransactionType;
    transactionId: string;
    field: 'category' | 'description';
    value: string;
};

export async function createLedgerTransaction(
    type: TransactionType,
    transaction: LedgerTransactionInput
): Promise<void> {
    if (import.meta.env.VITE_NO_AUTH === 'true') {
        console.log(`Mocking Ledger Transaction Create for ${type}`, transaction);
        return;
    }

    const res = await apiFetch(`/ledger/transactions?type=${type}`, {
        method: 'POST',
        body: JSON.stringify(transaction),
    });
    await res.text();
}

export async function updateLedgerTransaction(input: LedgerTransactionEditInput): Promise<void> {
    if (import.meta.env.VITE_NO_AUTH === 'true') {
        console.log('Mocking Ledger Transaction Update', input);
        return;
    }

    const res = await apiFetch('/ledger/transactions/edit', {
        method: 'POST',
        body: JSON.stringify(input),
    });
    await res.text();
}

export class OpeningBalanceRequiredError extends Error {
    constructor() {
        super('Opening balance is required for the first month.');
        this.name = 'OpeningBalanceRequiredError';
    }
}

export async function importLedgerCsv(contents: string, openingBalance?: number): Promise<void> {
    if (import.meta.env.VITE_NO_AUTH === 'true') {
        console.log('Mocking Ledger CSV Import');
        return;
    }

    const params = new URLSearchParams();
    if (openingBalance !== undefined) {
        params.set('openingBalance', openingBalance.toString());
    }
    const query = params.toString();
    const url = `/ledger/import${query ? `?${query}` : ''}`;

    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    const headers: Record<string, string> = { 'Content-Type': 'text/csv' };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const baseUrl = await resolveApiBaseUrl();
    const res = await fetch(`${baseUrl}${url}`, {
        method: 'POST',
        headers,
        body: contents
    });

    if (!res.ok) {
        const text = await res.text();
        try {
            const json = JSON.parse(text);
            if (json.needsOpeningBalance) {
                throw new OpeningBalanceRequiredError();
            }
            if (json.message || json.error) {
                throw new Error(json.message || json.error);
            }
        } catch (e) {
            if (e instanceof OpeningBalanceRequiredError) throw e;
            if (e instanceof Error && e.message !== text) throw e;
        }
        throw new Error(`API request failed: ${res.status} ${res.statusText}`);
    }
}

export type ReimbursementReceiptInput = {
    fileName: string;
    contentType: string;
    content: string;
};

export type ReimbursementSubmitInput = {
    requestId: string;
    category: string;
    purchaseDate: string;
    amount: number;
    description: string;
    memberMode: string;
    memberSearch?: string;
    memberName?: string;
    memberEmail?: string;
    memberPhone?: string;
    paymentMethod?: string;
    payId?: string;
    bsb?: string;
    accountNumber?: string;
    receipt?: ReimbursementReceiptInput;
};

export type ReimbursementListItem = {
    reference: string;
    status: string;
    title: string;
    amount: number;
    requestId?: string;
    createdAt?: string;
};

export async function submitReimbursement(payload: ReimbursementSubmitInput): Promise<void> {
    if (import.meta.env.VITE_NO_AUTH === 'true') {
        console.log('Mocking Reimbursement Submit', payload);
        return;
    }

    const res = await apiFetch('/reimbursements', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    await res.text();
}

export async function fetchReimbursementList(): Promise<ReimbursementListItem[]> {
    if (import.meta.env.VITE_NO_AUTH === 'true') {
        return [];
    }

    const res = await apiFetch('/reimbursement');
    const data = await res.json();
    if (!data) {
        throw new Error('Reimbursement list response was empty');
    }
    return data as ReimbursementListItem[];
}

export type FinancialReportLineItem = {
    label: string;
    amount: number;
};

export type FinancialReportNote = {
    title: string;
    details: string[];
};

export type FinancialReportResponse = {
    period: string;
    label: string;
    range: string;
    asAt: string;
    statement: {
        income: FinancialReportLineItem[];
        expenditure: FinancialReportLineItem[];
        totalIncome: number;
        totalExpenditure: number;
        netResult: number;
    };
    balanceSheet: {
        assets: FinancialReportLineItem[];
        liabilities: FinancialReportLineItem[];
        totalAssets: number;
        totalLiabilities: number;
        equity: number;
        equityLabel: string;
    };
    notes: FinancialReportNote[];
    monthlyBalances?: {
        month: string;
        bank: number;
        cash: number;
    }[];
};

export async function fetchFinancialReport(period: string): Promise<FinancialReportResponse> {
    const res = await apiFetch(`/reports/financial?period=${period}`);
    const data = await res.json();
    if (!data) {
        throw new Error('Financial report response was empty');
    }
    return data as FinancialReportResponse;
}
