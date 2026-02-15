import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api';
import { FaFolder, FaEdit, FaChevronLeft, FaSave, FaUpload, FaTimes, FaPlus } from 'react-icons/fa';
import ReactMarkdown from 'react-markdown';
import { useAppConfig } from '../providers/ConfigProvider';
import './Documents.css';

interface FileItem {
    name: string;
    path: string;
    isDir: boolean;
    size: number;
    modTime: string;
    token?: string;
    expires?: number;
}

const getMimeType = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'pdf': return 'application/pdf';
        case 'jpg':
        case 'jpeg': return 'image/jpeg';
        case 'png': return 'image/png';
        case 'gif': return 'image/gif';
        case 'webp': return 'image/webp';
        case 'svg': return 'image/svg+xml';
        case 'txt': return 'text/plain';
        case 'html': return 'text/html';
        default: return 'application/octet-stream';
    }
};

const isViewable = (filename: string): boolean => {
    const mime = getMimeType(filename);
    return mime !== 'application/octet-stream' || filename.toLowerCase().endsWith('.md');
};

const extractH1 = (markdown: string | null): string | null => {
    if (!markdown) return null;
    const match = markdown.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
};

import { usePageTitle } from '../hooks/usePageTitle';
import {FileList} from "../components/FileList/List.tsx";

export function Documents() {
    const { config } = useAppConfig();
    const [searchParams, setSearchParams] = useSearchParams();
    const currentPath = searchParams.get('path') || '';
    const currentFile = searchParams.get('file') || '';

    // Helper to update path in URL
    const setDocumentParams = (path: string, file?: string) => {
        const params: Record<string, string> = {};
        if (path) params.path = path;
        if (file) params.file = file;
        setSearchParams(params);
    };

    const [files, setFiles] = useState<FileItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editingFile, setEditingFile] = useState<FileItem | null>(null);
    const [editContent, setEditContent] = useState('');
    const [viewingFile, setViewingFile] = useState<FileItem | null>(null);
    const [viewContent, setViewContent] = useState('');
    const [indexContent, setIndexContent] = useState<string | null>(null);

    // Set page title: H1 from editor > filename > H1 from view > H1 from index > folder name > "Documents"
    const title = (editingFile ? (extractH1(editContent) || editingFile.name)
        : viewingFile ? (extractH1(viewContent) || viewingFile.name)
            : (indexContent ? extractH1(indexContent) : null))
        || (currentPath.split('/').filter(Boolean).pop() || 'Documents');
    usePageTitle(title);

    const fetchFiles = async (path: string) => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiFetch(`/documents/list?path=${encodeURIComponent(path)}`);
            if (!res.ok) throw new Error('Failed to fetch files');
            const data: FileItem[] = await res.json();
            setFiles(data);

            const indexFile = data.find(f => f.name.toLowerCase() === 'index.md');
            if (indexFile) {
                const indexRes = await apiFetch(`/documents/view?path=${encodeURIComponent(indexFile.path)}`);
                if (indexRes.ok) {
                    const base64 = await indexRes.text();
                    const text = atob(base64);
                    setIndexContent(text);
                } else {
                    setIndexContent(null);
                }
            } else {
                setIndexContent(null);
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const loadMarkdown = async (file: FileItem) => {
        const res = await apiFetch(`/documents/view?path=${encodeURIComponent(file.path)}`);
        if (!res.ok) throw new Error('Failed to load file');
        const base64 = await res.text();
        return atob(base64);
    };

    useEffect(() => {
        fetchFiles(currentPath);
    }, [currentPath]);

    useEffect(() => {
        if (!currentFile) {
            setViewingFile(null);
            setViewContent('');
            return;
        }

        const targetPath = currentPath ? `${currentPath}/${currentFile}` : currentFile;
        if (editingFile && editingFile.path === targetPath) {
            return;
        }
        const file = files.find(f => f.path === targetPath) || { name: currentFile, path: targetPath, isDir: false, size: 0, modTime: '' };
        if (file.isDir || !file.name.endsWith('.md')) {
            setViewingFile(null);
            setViewContent('');
            return;
        }

        if (!viewingFile || viewingFile.path !== file.path) {
            setLoading(true);
            loadMarkdown(file)
                .then((text) => {
                    setViewingFile(file);
                    setViewContent(text);
                })
                .catch((err: any) => {
                    alert(err.message);
                })
                .finally(() => {
                    setLoading(false);
                });
        }
    }, [currentFile, currentPath, files, viewingFile, editingFile]);

    const navigateTo = (path: string) => {

        setDocumentParams(path);
        setEditingFile(null);
        setViewingFile(null);
        setViewContent('');
        setIndexContent(null);
    };

    const goBack = () => {
        const parts = currentPath.split('/').filter(Boolean);
        parts.pop();
        navigateTo(parts.join('/'));
    };

    const handleEdit = async (file: FileItem) => {
        if (currentFile !== file.name) {
            setDocumentParams(currentPath, file.name);
        }
        setViewingFile(null);
        setViewContent('');
        setLoading(true);
        try {
            const text = await loadMarkdown(file);
            setEditContent(text);
            setEditingFile(file);
        } catch (err: any) {
            alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleView = async (file: FileItem) => {
        if (currentFile !== file.name) {
            setDocumentParams(currentPath, file.name);
        }
        setEditingFile(null);
        setLoading(true);
        try {
            const text = await loadMarkdown(file);
            setViewingFile(file);
            setViewContent(text);
        } catch (err: any) {
            alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    const putToS3 = async (path: string, body: BodyInit, contentType: string) => {
        const s3Url = `/documents/s3/${encodeURI(path)}`;
        const res = await fetch(s3Url, {
            method: 'PUT',
            headers: {
                'Content-Type': contentType
            },
            body
        });
        if (!res.ok) {
            throw new Error(`S3 write failed (${res.status})`);
        }
    };

    const handleSave = async () => {
        if (!editingFile) return;
        setLoading(true);
        try {
            await putToS3(editingFile.path, editContent, 'text/markdown');
            setDocumentParams(currentPath);
            setEditingFile(null);
            fetchFiles(currentPath);
        } catch (err: any) {
            alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setLoading(true);
        try {
            const uploadPath = currentPath ? `${currentPath}/${file.name}` : file.name;
            await putToS3(uploadPath, await file.arrayBuffer(), file.type || 'application/octet-stream');
            fetchFiles(currentPath);
        } catch (err: any) {
            alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                const file = items[i].getAsFile();
                if (!file) continue;

                setLoading(true);
                try {
                    const ext = file.type.split('/')[1] || 'png';
                    const filename = `${crypto.randomUUID()}.${ext}`;
                    const uploadPath = currentPath ? `${currentPath}/${filename}` : filename;
                    const textarea = e.currentTarget;
                    const start = textarea.selectionStart;
                    const end = textarea.selectionEnd;

                    await putToS3(uploadPath, await file.arrayBuffer(), file.type || 'application/octet-stream');

                    // Insert markdown at previously captured selection
                    const text = textarea.value;
                    const before = text.substring(0, start);
                    const after = text.substring(end);
                    const imageMarkdown = `\n![image](${filename})\n`;
                    const newContent = before + imageMarkdown + after;

                    setEditContent(newContent);
                    // Force refresh file list so the new image appears in index if linked
                    fetchFiles(currentPath);

                    // Set cursor position after the inserted markdown (need to do this in next tick)
                    setTimeout(() => {
                        textarea.focus();
                        const newPos = start + imageMarkdown.length;
                        textarea.setSelectionRange(newPos, newPos);
                    }, 0);
                } catch (err: any) {
                    alert(err.message);
                } finally {
                    setLoading(false);
                }
            }
        }
    };

    const getFileUrl = (file: FileItem) => {
        if (!config) return '';
        const encodedPath = encodeURI(file.path);
        return `/documents/s3/${encodedPath}`;
    };

    const handleFileAction = (file: FileItem, mode: 'download' | 'view' = 'download') => {
        const url = getFileUrl(file);
        if (!url) {
            alert('File access not available (missing signature)');
            return;
        }

        if (mode === 'view') {
            window.open(url, '_blank');
        } else {
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    };

    const createFolder = async () => {
        const name = prompt('Enter folder name:');
        if (name) {
            const path = currentPath ? `${currentPath}/${name}` : name;
            setLoading(true);
            try {
                const res = await apiFetch(`/documents/mkdir?path=${encodeURIComponent(path)}`, {
                    method: 'POST'
                });
                if (!res.ok) throw new Error('Failed to create folder');
                fetchFiles(currentPath);
            } catch (err: any) {
                alert(err.message);
            } finally {
                setLoading(false);
            }
        }
    };

    const createMarkdown = () => {
        const name = prompt('Enter filename (e.g. notes.md):');
        if (name) {
            const fileName = name.endsWith('.md') ? name : `${name}.md`;
            const path = currentPath ? `${currentPath}/${fileName}` : fileName;
            setViewingFile(null);
            setViewContent('');
            setEditingFile({ name: fileName, path, isDir: false, size: 0, modTime: '' });
            setEditContent('# ' + fileName + '\n\nContent here...');
        }
    };

    const MarkdownImage = ({ src, alt }: any) => {
        if (!src) return null;
        // Resolve relative path to full path
        let targetPath = src;
        if (!src.startsWith('/') && !src.startsWith('http')) {
            targetPath = currentPath ? `${currentPath}/${src}` : src;
        } else if (src.startsWith('/')) {
            targetPath = src.substring(1);
        }

        targetPath = targetPath.replace(/\/+/g, '/').replace(/\/$/, '');

        // Find file in current file list to get its signature components
        const file = files.find(f => f.path === targetPath);
        if (file) {
            const imageUrl = getFileUrl(file);
            if (imageUrl) return <img src={imageUrl} alt={alt} style={{ maxWidth: '100%' }} />;
        }

        // Fallback or missing signature
        return <span className="error-text">Image not found or access expired</span>;
    };

    const MarkdownLink = ({ href, children }: any) => {
        const handleClick = (e: React.MouseEvent) => {
            if (href && !href.startsWith('http') && !href.startsWith('mailto')) {
                e.preventDefault();
                let targetPath = href;
                if (!href.startsWith('/')) {
                    targetPath = currentPath ? `${currentPath}/${href}` : href;
                } else {
                    targetPath = href.substring(1);
                }

                targetPath = targetPath.replace(/\/+/g, '/').replace(/\/$/, '');

                const file = files.find(f => f.path === targetPath || f.path === targetPath + '/');
                if (file) {
                    if (file.isDir) {
                        navigateTo(file.path);
                    } else if (file.name.endsWith('.md')) {
                        handleView(file);
                    } else if (isViewable(file.name)) {
                        handleFileAction(file, 'view');
                    } else {
                        handleFileAction(file, 'download');
                    }
                } else {
                    if (href.endsWith('/') || !href.includes('.')) {
                        navigateTo(targetPath);
                    } else {
                        const fileName = targetPath.split('/').pop() || '';
                        if (fileName.endsWith('.md')) {
                            handleView({ name: fileName, path: targetPath, isDir: false, size: 0, modTime: '' });
                        } else if (isViewable(fileName)) {
                            handleFileAction({ name: fileName, path: targetPath, isDir: false, size: 0, modTime: '' }, 'view');
                        } else {
                            handleFileAction({ name: fileName, path: targetPath, isDir: false, size: 0, modTime: '' }, 'download');
                        }
                    }
                }
            }
        };

        return (
            <a href={href} onClick={handleClick} target={href?.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
                {children}
            </a>
        );
    };

    if (editingFile) {
        return (
            <div className="page-container">
                <div className="docs-header">
                    <h2>Editing: {editingFile.name}</h2>
                    <div className="docs-actions">
                        <button onClick={() => { setDocumentParams(currentPath); setEditingFile(null); }} className="btn-secondary">
                            <FaTimes /> Cancel
                        </button>
                        <button onClick={handleSave} className="btn-primary" disabled={loading}>
                            <FaSave /> Save
                        </button>
                    </div>
                </div>
                <div className="editor-container">
                    <textarea
                        className="markdown-editor"
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        onPaste={handlePaste}
                    />
                    <div className="markdown-preview">
                        <ReactMarkdown components={{ a: MarkdownLink, img: MarkdownImage }}>{editContent}</ReactMarkdown>
                    </div>
                </div>
            </div>
        );
    }

    if (viewingFile) {
        return (
            <div className="page-container">
                <div className="docs-header">
                    <h2>{viewingFile.name}</h2>
                    <div className="docs-actions">
                        <button onClick={() => handleEdit(viewingFile)} className="btn-secondary">
                            <FaEdit /> Edit
                        </button>
                        <button onClick={() => { setDocumentParams(currentPath); setViewingFile(null); setViewContent(''); }} className="btn-secondary">
                            <FaTimes /> Close
                        </button>
                    </div>
                </div>
                {loading && <div className="loading">Loading...</div>}
                {!loading && (
                    <div className="docs-content">
                        <div className="markdown-view card">
                            <ReactMarkdown components={{ a: MarkdownLink, img: MarkdownImage }}>{viewContent}</ReactMarkdown>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="page-container">
            <div className="docs-header">
                <div className="docs-breadcrumb">
                    <button onClick={() => navigateTo('')} className="btn-link">Documents</button>
                    {currentPath.split('/').filter(Boolean).map((part, i, arr) => (
                        <span key={i}>
                            {' / '}
                            <button
                                onClick={() => navigateTo(arr.slice(0, i + 1).join('/'))}
                                className="btn-link"
                            >
                                {part}
                            </button>
                        </span>
                    ))}
                </div>
                <div className="docs-actions">
                    <button onClick={createFolder} className="btn-outline">
                        <FaFolder /> New Folder
                    </button>
                    <button onClick={createMarkdown} className="btn-outline">
                        <FaPlus /> New MD
                    </button>
                    <label className="btn-primary upload-label">
                        <FaUpload /> Upload
                        <input type="file" onChange={handleUpload} style={{ display: 'none' }} />
                    </label>
                    {currentPath && (
                        <button onClick={goBack} className="btn-secondary">
                            <FaChevronLeft /> Back
                        </button>
                    )}
                </div>
            </div>

            {loading && <div className="loading">Loading...</div>}
            {error && <div className="error-card">{error}</div>}

            {!loading && !error && (
                <div className="docs-content">
                    {indexContent ? (
                        <div className="markdown-view card">
                            <div className="index-header">
                                <button
                                    onClick={() => handleEdit(files.find(f => f.name.toLowerCase() === 'index.md')!)}
                                    className="btn-icon"
                                    title="Edit index.md"
                                >
                                    <FaEdit />
                                </button>
                            </div>
                            <ReactMarkdown components={{ a: MarkdownLink, img: MarkdownImage }}>{indexContent}</ReactMarkdown>
                            <hr />
                            <h4>Directory Listing</h4>
                            <FileList
                                files={files}
                                onNavigate={navigateTo}
                                onEdit={handleEdit}
                                onView={handleView}
                                onFileAction={handleFileAction}
                                getFileUrl={getFileUrl}
                                isViewable={isViewable}
                            />
                        </div>
                    ) : (
                        <FileList
                            files={files}
                            onNavigate={navigateTo}
                            onEdit={handleEdit}
                            onView={handleView}
                            onFileAction={handleFileAction}
                            getFileUrl={getFileUrl}
                            isViewable={isViewable}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
