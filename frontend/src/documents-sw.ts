/// <reference lib="webworker" />

const S3_PATH_PREFIX = '/documents/s3/';
const DEFAULT_CREDENTIALS_TTL_MS = 14 * 60 * 1000;

type RuntimeConfig = {
  apiBaseUrl: string;
  documentS3Base: string;
};

type Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  region: string;
  expiresAt: number;
};

type CredentialsResponse = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
  region: string;
};

let cachedConfig: RuntimeConfig | null = null;
let configPromise: Promise<RuntimeConfig> | null = null;

let credentialsCache: Credentials | null = null;
let credentialsPromise: Promise<Credentials> | null = null;

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', (event) => {
  event.waitUntil(sw.skipWaiting());
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(sw.clients.claim());
});

sw.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (!requestUrl.pathname.startsWith(S3_PATH_PREFIX)) {
    return;
  }

  event.respondWith(handleS3Fetch(event.request, requestUrl));
});

async function handleS3Fetch(request: Request, requestUrl: URL) {
  const config = await loadConfig();
  if (!config.documentS3Base) {
    return fetch(request);
  }

  const keyPath = requestUrl.pathname.slice(S3_PATH_PREFIX.length);
  if (!keyPath) {
    return new Response('Missing S3 path', { status: 400 });
  }

  const targetUrl = new URL(buildTargetUrl(config.documentS3Base, keyPath));
  targetUrl.search = requestUrl.search;

  const credentials = await getCredentials(config.apiBaseUrl);
  if (!credentials) {
    return new Response('Unauthorized', { status: 401 });
  }

  const signedRequest = await signRequest(request, targetUrl, credentials);
  return fetch(signedRequest);
}

function buildTargetUrl(baseUrl: string, keyPath: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedKey = keyPath.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedKey}`;
}

async function loadConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  if (!configPromise) {
    configPromise = fetch('/config.json', { cache: 'no-cache' })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Unable to load config.json');
        }
        return response.json();
      })
      .then((rawConfig: Record<string, unknown>) => {
        cachedConfig = {
          apiBaseUrl: typeof rawConfig.apiBaseUrl === 'string' ? rawConfig.apiBaseUrl.trim() : '',
          documentS3Base: typeof rawConfig.documentS3Base === 'string' ? rawConfig.documentS3Base.trim() : ''
        };
        return cachedConfig;
      })
      .catch((error) => {
        configPromise = null;
        throw error;
      });
  }

  return configPromise;
}

async function getCredentials(apiBaseUrl: string) {
  if (credentialsCache && !isExpired(credentialsCache)) {
    return credentialsCache;
  }

  if (!credentialsPromise) {
    credentialsPromise = fetchCredentials(apiBaseUrl)
      .then((credentials) => {
        credentialsCache = credentials;
        return credentials;
      })
      .catch((error) => {
        console.error('Failed to fetch S3 credentials', error);
        credentialsCache = null;
        throw error;
      })
      .finally(() => {
        credentialsPromise = null;
      });
  }

  return credentialsPromise;
}

function isExpired(credentials: Credentials) {
  const now = Date.now();
  return credentials.expiresAt <= now + 30 * 1000;
}

async function fetchCredentials(apiBaseUrl: string): Promise<Credentials> {
  const token = await requestAuthToken();
  const headers = new Headers();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${apiBaseUrl}/documents/credentials`, {
    headers
  });

  if (!response.ok) {
    throw new Error(`Credentials request failed (${response.status})`);
  }

  const payload = await response.json() as CredentialsResponse;
  const expiresAt = Date.parse(payload.expiration) || (Date.now() + DEFAULT_CREDENTIALS_TTL_MS);
  return {
    accessKeyId: payload.accessKeyId,
    secretAccessKey: payload.secretAccessKey,
    sessionToken: payload.sessionToken,
    region: payload.region,
    expiresAt
  };
}

function requestAuthToken() {
  return new Promise<string>((resolve) => {
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      if (!clients.length) {
        resolve('');
        return;
      }

      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        resolve(event.data && event.data.token ? event.data.token : '');
      };

      clients[0].postMessage({ type: 'REQUEST_AUTH_TOKEN' }, [channel.port2]);
    }).catch(() => resolve(''));
  });
}

async function signRequest(originalRequest: Request, targetUrl: URL, credentials: Credentials) {
  const method = originalRequest.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await originalRequest.clone().arrayBuffer();

  const headers = new Headers(originalRequest.headers);
  headers.delete('authorization');
  headers.delete('host');

  const amzDate = toAmzDate(new Date());
  headers.set('x-amz-date', amzDate);
  headers.set('x-amz-security-token', credentials.sessionToken);
  headers.set('x-amz-content-sha256', 'UNSIGNED-PAYLOAD');

  const headersForSigning = new Headers(headers);
  headersForSigning.set('host', targetUrl.host);

  const signed = await createAuthorizationHeader({
    method,
    url: targetUrl,
    headers: headersForSigning,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    region: credentials.region
  });

  headers.set('Authorization', signed);

  return new Request(targetUrl.toString(), {
    method,
    headers,
    body
  });
}

async function createAuthorizationHeader({
  method,
  url,
  headers,
  accessKeyId,
  secretAccessKey,
  region
}: {
  method: string;
  url: URL;
  headers: Headers;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}) {
  const service = 's3';
  const amzDate = headers.get('x-amz-date');
  if (!amzDate) {
    throw new Error('Missing x-amz-date header');
  }
  const dateStamp = amzDate.slice(0, 8);

  const { canonicalHeaders, signedHeaders } = buildCanonicalHeaders(headers);
  const canonicalRequest = [
    method,
    buildCanonicalUri(url),
    buildCanonicalQueryString(url),
    `${canonicalHeaders}\n`,
    signedHeaders,
    'UNSIGNED-PAYLOAD'
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join('\n');

  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = await hmacHex(signingKey, stringToSign);

  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function buildCanonicalHeaders(headers: Headers) {
  const headerEntries: Array<[string, string]> = [];
  headers.forEach((value, key) => {
    headerEntries.push([key.toLowerCase(), value.trim().replace(/\s+/g, ' ')]);
  });

  headerEntries.sort((a, b) => a[0].localeCompare(b[0]));

  const canonicalHeaders = headerEntries.map(([key, value]) => `${key}:${value}`).join('\n');
  const signedHeaders = headerEntries.map(([key]) => key).join(';');
  return { canonicalHeaders, signedHeaders };
}

function buildCanonicalUri(url: URL) {
  const pathname = url.pathname || '/';
  return encodeURI(pathname).replace(/\+/g, '%2B');
}

function buildCanonicalQueryString(url: URL) {
  const params: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => {
    params.push([encodeRfc3986(key), encodeRfc3986(value)]);
  });
  params.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  return params.map(([key, value]) => `${key}=${value}`).join('&');
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function toAmzDate(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

async function sha256Hex(message: string) {
  const data = new TextEncoder().encode(message);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(digest);
}

async function hmacHex(key: ArrayBuffer | string, message: string) {
  const keyData = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return bufferToHex(signature);
}

async function getSignatureKey(secretAccessKey: string, dateStamp: string, region: string, service: string) {
  const kDate = await hmacBinary(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacBinary(kDate, region);
  const kService = await hmacBinary(kRegion, service);
  return hmacBinary(kService, 'aws4_request');
}

async function hmacBinary(key: ArrayBuffer | string, message: string) {
  const keyData = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

function bufferToHex(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let result = '';
  for (let i = 0; i < bytes.length; i += 1) {
    result += bytes[i].toString(16).padStart(2, '0');
  }
  return result;
}
