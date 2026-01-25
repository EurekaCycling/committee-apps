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
