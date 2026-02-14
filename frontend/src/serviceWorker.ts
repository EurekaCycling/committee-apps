import { fetchAuthSession } from 'aws-amplify/auth';

const SERVICE_WORKER_PATH = '/documents-sw.js';

export function registerDocumentsServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: '/' })
        .catch((error) => {
            console.warn('Failed to register documents service worker', error);
        });

    navigator.serviceWorker.addEventListener('message', (event) => {
        if (!event.data || event.data.type !== 'REQUEST_AUTH_TOKEN') {
            return;
        }

        const port = event.ports && event.ports[0];
        if (!port) {
            return;
        }

        if (import.meta.env.VITE_NO_AUTH === 'true') {
            port.postMessage({ token: '' });
            return;
        }

        fetchAuthSession()
            .then((session) => {
                const token = session.tokens?.idToken?.toString() || '';
                port.postMessage({ token });
            })
            .catch(() => {
                port.postMessage({ token: '' });
            });
    });
}
