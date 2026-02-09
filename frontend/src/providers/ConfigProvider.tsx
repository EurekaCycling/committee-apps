import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchAppConfig, type AppConfig } from '../config';

type ConfigContextValue = {
    config: AppConfig | null;
    error: string | null;
    isLoading: boolean;
};

const ConfigContext = createContext<ConfigContextValue | undefined>(undefined);

type ConfigProviderProps = {
    children: ReactNode;
};

export function ConfigProvider({ children }: ConfigProviderProps) {
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;
        fetchAppConfig()
            .then((loadedConfig) => {
                if (isMounted) {
                    setConfig(loadedConfig);
                    setIsLoading(false);
                }
            })
            .catch((loadError) => {
                if (isMounted) {
                    setError(loadError?.message || 'Unable to load runtime configuration');
                    setIsLoading(false);
                }
            });

        return () => {
            isMounted = false;
        };
    }, []);

    const value = useMemo(() => ({
        config,
        error,
        isLoading
    }), [config, error, isLoading]);

    return (
        <ConfigContext.Provider value={value}>
            {children}
        </ConfigContext.Provider>
    );
}

export function useAppConfig() {
    const context = useContext(ConfigContext);
    if (!context) {
        throw new Error('useAppConfig must be used within ConfigProvider');
    }
    return context;
}
