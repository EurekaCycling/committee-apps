import type { MouseEvent, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { useFileList } from '../providers/FileListProvider';

export interface MarkdownFileItem {
    url?: string;
    name: string;
    path: string;
    isDir: boolean;
    size: number;
    modTime: string;
    token?: string;
    expires?: number;
}

export interface MarkdownViewerProps {
    content: string;
    currentPath: string;
    files: MarkdownFileItem[];
    getFileUrl: (file: MarkdownFileItem) => string;
    navigateTo: (path: string) => void;
    onView: (file: MarkdownFileItem) => void;
    onFileAction: (file: MarkdownFileItem, mode: 'download' | 'view') => void;
    isViewable: (filename: string) => boolean;
}

export function MarkdownViewer({
    content,
    currentPath,
    files,
    getFileUrl,
    navigateTo,
    onView,
    onFileAction,
    isViewable
}: MarkdownViewerProps) {
    const { files: contextFiles } = useFileList();
    const MarkdownImage = ({ src, alt }: { src?: string; alt?: string }) => {
        if (!src) return null;
        let targetPath = src;
        if (!src.startsWith('/') && !src.startsWith('http')) {
            targetPath = currentPath ? `${currentPath}/${src}` : src;
        } else if (src.startsWith('/')) {
            targetPath = src.substring(1);
        }

        targetPath = targetPath.replace(/\/+/g, '/').replace(/\/$/, '');

        const file = contextFiles.find(f => f.path === targetPath);
        if (file) {
            const imageUrl = file.url || getFileUrl(file);
            if (imageUrl) return <img src={imageUrl} alt={alt} style={{ maxWidth: '100%' }} />;
        }

        return <span className="error-text">Image not found or access expired</span>;
    };

    const MarkdownLink = ({ href, children }: { href?: string; children?: ReactNode }) => {
        const isInternal = href && !href.startsWith('http') && !href.startsWith('mailto');

        const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
            if (!href || !isInternal) return;
            event.preventDefault();
            let targetPath = href;
            if (!href.startsWith('/')) {
                targetPath = currentPath ? `${currentPath}/${href}` : href;
            } else {
                targetPath = href.substring(1);
            }

            targetPath = targetPath.replace(/\/+/g, '/').replace(/\/$/, '');

            const file = files.find(f => f.path === targetPath || f.path === `${targetPath}/`);
            if (file) {
                if (file.isDir) {
                    navigateTo(file.path);
                } else if (file.name.endsWith('.md')) {
                    onView(file);
                } else if (isViewable(file.name)) {
                    onFileAction(file, 'view');
                } else {
                    onFileAction(file, 'download');
                }
                return;
            }

            if (href.endsWith('/') || !href.includes('.')) {
                navigateTo(targetPath);
                return;
            }

            const fileName = targetPath.split('/').pop() || '';
            if (fileName.endsWith('.md')) {
                onView({ name: fileName, path: targetPath, isDir: false, size: 0, modTime: '' });
            } else if (isViewable(fileName)) {
                onFileAction({ name: fileName, path: targetPath, isDir: false, size: 0, modTime: '' }, 'view');
            } else {
                onFileAction({ name: fileName, path: targetPath, isDir: false, size: 0, modTime: '' }, 'download');
            }
        };

        return (
            <a
                href={href}
                onClick={handleClick}
                target={href?.startsWith('http') ? '_blank' : undefined}
                rel="noreferrer"
            >
                {children}
            </a>
        );
    };

    return <ReactMarkdown components={{ a: MarkdownLink, img: MarkdownImage }}>{content}</ReactMarkdown>;
}
