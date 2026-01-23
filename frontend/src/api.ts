import { fetchAuthSession } from 'aws-amplify/auth';
import { generateMockLedger, CATEGORIES } from './mocks/ledgerData';
import type { MonthlyLedger, TransactionType } from './mocks/ledgerData';

const BASE_URL = import.meta.env.PROD
    ? 'https://api.committee.eurekacycling.org.au'
    : 'http://127.0.0.1:3000';

export async function apiFetch(path: string, options: RequestInit = {}) {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();

    const headers = new Headers(options.headers);
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers,
    });

    if (response.status === 401) {
        throw new Error('Unauthorized: Please login.');
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
    if (!res.ok) {
        throw new Error(`Failed to fetch ledger: ${res.statusText}`);
    }
    return res.json();
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

    if (!res.ok) {
        throw new Error(`Failed to save ledger: ${res.statusText}`);
    }
}

export async function fetchCategories(): Promise<string[]> {
    if (import.meta.env.VITE_NO_AUTH === 'true') {
        return CATEGORIES;
    }

    const res = await apiFetch(`/ledger/categories`);
    if (!res.ok) {
        throw new Error(`Failed to fetch categories: ${res.statusText}`);
    }
    return res.json();
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

    if (!res.ok) {
        throw new Error(`Failed to save categories: ${res.statusText}`);
    }
}
