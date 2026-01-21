import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api';
import { FaFolder, FaFileAlt, FaEdit, FaChevronLeft, FaSave, FaUpload, FaTimes, FaPlus, FaEye } from 'react-icons/fa';
import ReactMarkdown from 'react-markdown';
import './Documents.css';

interface FileItem {
    name: string;
    path: string;
    isDir: boolean;
    size: number;
    modTime: string;
    url?: string;
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

export function Documents() {
    const [searchParams, setSearchParams] = useSearchParams();
    const currentPath = searchParams.get('path') || '';

    // Helper to update path in URL
    const setCurrentPath = (path: string) => {
        if (path) {
            setSearchParams({ path });
        } else {
            setSearchParams({});
        }
    };

    const [files, setFiles] = useState<FileItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editingFile, setEditingFile] = useState<FileItem | null>(null);
    const [editContent, setEditContent] = useState('');
    const [indexContent, setIndexContent] = useState<string | null>(null);

    // Set page title: H1 from editor > filename > H1 from index > folder name > "Documents"
    const title = (editingFile ? (extractH1(editContent) || editingFile.name) : (indexContent ? extractH1(indexContent) : null))
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

    useEffect(() => {
        fetchFiles(currentPath);
    }, [currentPath]);

    const navigateTo = (path: string) => {
        setCurrentPath(path);
        setEditingFile(null);
        setIndexContent(null);
    };

    const goBack = () => {
        const parts = currentPath.split('/').filter(Boolean);
        parts.pop();
        navigateTo(parts.join('/'));
    };

    const handleEdit = async (file: FileItem) => {
        setLoading(true);
        try {
            const res = await apiFetch(`/documents/view?path=${encodeURIComponent(file.path)}`);
            if (!res.ok) throw new Error('Failed to load file');
            const base64 = await res.text();
            const text = atob(base64);
            setEditContent(text);
            setEditingFile(file);
        } catch (err: any) {
            alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!editingFile) return;
        setLoading(true);
        try {
            const res = await apiFetch(`/documents/save?path=${encodeURIComponent(editingFile.path)}`, {
                method: 'POST',
                body: editContent
            });
            if (!res.ok) throw new Error('Failed to save file');
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
            const reader = new FileReader();
            reader.onload = async (e) => {
                const base64Content = (e.target?.result as string).split(',')[1];
                const uploadPath = currentPath ? `${currentPath}/${file.name}` : file.name;

                const res = await apiFetch(`/documents/upload?path=${encodeURIComponent(uploadPath)}`, {
                    method: 'POST',
                    body: base64Content
                });

                if (!res.ok) throw new Error('Upload failed');
                fetchFiles(currentPath);
            };
            reader.readAsDataURL(file);
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

                    const reader = new FileReader();
                    const textarea = e.currentTarget;
                    const start = textarea.selectionStart;
                    const end = textarea.selectionEnd;

                    reader.onload = async (re) => {
                        const base64Content = (re.target?.result as string).split(',')[1];
                        const res = await apiFetch(`/documents/upload?path=${encodeURIComponent(uploadPath)}`, {
                            method: 'POST',
                            body: base64Content
                        });

                        if (!res.ok) throw new Error('Upload failed');

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
                    };
                    reader.readAsDataURL(file);
                } catch (err: any) {
                    alert(err.message);
                } finally {
                    setLoading(false);
                }
            }
        }
    };

    const handleFileAction = (file: FileItem, mode: 'download' | 'view' = 'download') => {
        if (!file.url) {
            alert('File URL not available');
            return;
        }

        if (mode === 'view') {
            window.open(file.url, '_blank');
        } else {
            const a = document.createElement('a');
            a.href = file.url;
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

        // Find file in current file list to get its signed URL
        const file = files.find(f => f.path === targetPath);
        const imageUrl = file?.url || `/documents/view?path=${encodeURIComponent(targetPath)}`;

        return <img src={imageUrl} alt={alt} style={{ maxWidth: '100%' }} />;
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
                        handleEdit(file);
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
                            handleEdit({ name: fileName, path: targetPath, isDir: false, size: 0, modTime: '' });
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
                        <button onClick={() => setEditingFile(null)} className="btn-secondary">
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
                            <FileList files={files} onNavigate={navigateTo} onEdit={handleEdit} onFileAction={handleFileAction} />
                        </div>
                    ) : (
                        <FileList files={files} onNavigate={navigateTo} onEdit={handleEdit} onFileAction={handleFileAction} />
                    )}
                </div>
            )}
        </div>
    );
}

function FileList({ files, onNavigate, onEdit, onFileAction }: {
    files: FileItem[],
    onNavigate: (path: string) => void,
    onEdit: (file: FileItem) => void,
    onFileAction: (file: FileItem, mode: 'download' | 'view') => void
}) {
    return (
        <div className="file-list card">
            {files.length === 0 && <p className="empty-msg">No files in this directory.</p>}
            <table>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Size</th>
                        <th>Modified</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {files.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
                        .filter(f => f.name.toLowerCase() !== 'index.md')
                        .map(file => (
                            <tr key={file.path}>
                                <td onClick={() => file.isDir && onNavigate(file.path)} className={file.isDir ? 'clickable' : ''}>
                                    {file.isDir ? <FaFolder className="icon-folder" /> : <FaFileAlt className="icon-file" />}
                                    {file.name}
                                </td>
                                <td>{file.isDir ? '-' : formatSize(file.size)}</td>
                                <td>{file.modTime ? new Date(file.modTime).toLocaleDateString() : '-'}</td>
                                <td>
                                    {!file.isDir && file.name.endsWith('.md') && (
                                        <button onClick={() => onEdit(file)} className="btn-icon" title="Edit">
                                            <FaEdit />
                                        </button>
                                    )}
                                    {!file.isDir && isViewable(file.name) && (
                                        <button onClick={() => onFileAction(file, 'view')} className="btn-icon" title="View in new tab">
                                            <FaEye />
                                        </button>
                                    )}
                                    {!file.isDir && (
                                        <button onClick={() => onFileAction(file, 'download')} className="btn-icon" title="Download">
                                            <FaUpload style={{ transform: 'rotate(180deg)' }} />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                </tbody>
            </table>
        </div>
    );
}

function formatSize(bytes: number) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
