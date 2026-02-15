import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { apiFetch } from '../api';

export type FileItem = {
    url?: string;
    name: string;
    path: string;
    isDir: boolean;
    size: number;
    modTime: string;
    token?: string;
    expires?: number;
};

type FileListContextValue = {
    files: FileItem[];
    error: string | null;
    indexContent: string | null;
    isLoading: boolean;
    fetchFiles: (path: string) => Promise<void>;
};

const FileListContext = createContext<FileListContextValue | undefined>(undefined);

type FileListProviderProps = {
    children: ReactNode;
};

export function FileListProvider({ children }: FileListProviderProps) {
    const [files, setFiles] = useState<FileItem[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [indexContent, setIndexContent] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const fetchFiles = useCallback(async (path: string) => {
        setIsLoading(true);
        setError(null);
        setIndexContent(null);
        try {
            const res = await apiFetch(`/documents/list?path=${encodeURIComponent(path)}`);
            if (!res.ok) throw new Error('Failed to fetch files');
            const data: FileItem[] = await res.json();
            setFiles(data);

            const indexFile = data.find((file) => file.name.toLowerCase() === 'index.md');
            if (indexFile) {
                const indexRes = await apiFetch(`/documents/view?path=${encodeURIComponent(indexFile.path)}`);
                if (indexRes.ok) {
                    const base64 = await indexRes.text();
                    const text = atob(base64);
                    setIndexContent(text);
                }
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to fetch files';
            setError(message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const value = useMemo(() => ({
        files,
        error,
        indexContent,
        isLoading,
        fetchFiles
    }), [files, error, indexContent, isLoading, fetchFiles]);

    return (
        <FileListContext.Provider value={value}>
            {children}
        </FileListContext.Provider>
    );
}

export function useFileList() {
    const context = useContext(FileListContext);
    if (!context) {
        throw new Error('useFileList must be used within FileListProvider');
    }
    return context;
}
