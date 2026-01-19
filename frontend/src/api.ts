import { fetchAuthSession } from 'aws-amplify/auth';

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
