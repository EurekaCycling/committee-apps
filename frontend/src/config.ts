export interface CognitoConfig {
    userPoolId: string;
    userPoolClientId: string;
}

export interface AppConfig {
    apiBaseUrl: string;
    cognito: CognitoConfig;
}

const CONFIG_FILE = 'config.json';

let cachedConfig: AppConfig | null = null;
let configPromise: Promise<AppConfig> | null = null;

function getConfigUrl() {
    const base = new URL(import.meta.env.BASE_URL, window.location.origin);
    //const base = "https://committee2.eurekacycling.org.au/"
    return new URL(CONFIG_FILE, base).toString();
}

function normalizeString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

export async function fetchAppConfig(): Promise<AppConfig> {
    if (cachedConfig) {
        return cachedConfig;
    }

    if (!configPromise) {
        configPromise = fetch(getConfigUrl(), { cache: 'no-cache' })
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Failed to load ${CONFIG_FILE} (${response.status})`);
                }
                return response.json();
            })
            .then((rawConfig: Record<string, unknown>) => {
                const cognitoSettings = rawConfig.cognito as Record<string, unknown> | undefined;
                const normalized: AppConfig = {
                    apiBaseUrl: normalizeString(rawConfig.apiBaseUrl),
                    cognito: {
                        userPoolId: normalizeString(cognitoSettings?.userPoolId),
                        userPoolClientId: normalizeString(cognitoSettings?.userPoolClientId)
                    }
                };

                if (!normalized.apiBaseUrl) {
                    throw new Error(`${CONFIG_FILE} must include an apiBaseUrl value`);
                }

                cachedConfig = normalized;
                return normalized;
            })
            .catch((error) => {
                configPromise = null;
                throw error;
            });
    }

    return configPromise;
}
