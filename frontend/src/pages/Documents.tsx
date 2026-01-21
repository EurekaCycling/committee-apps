import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api';
import { FaFolder, FaFileAlt, FaEdit, FaChevronLeft, FaSave, FaUpload, FaTimes, FaPlus } from 'react-icons/fa';
import ReactMarkdown from 'react-markdown';
import './Documents.css';

interface FileItem {
    name: string;
    path: string;
    isDir: boolean;
    size: number;
    modTime: string;
}

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

    const handleDownload = async (file: FileItem) => {
        setLoading(true);
        try {
            const res = await apiFetch(`/documents/view?path=${encodeURIComponent(file.path)}`);
            if (!res.ok) throw new Error('Failed to load file');
            const base64 = await res.text();

            const binaryString = window.atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: 'application/octet-stream' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (err: any) {
            alert(err.message);
        } finally {
            setLoading(false);
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
                    } else {
                        handleEdit(file);
                    }
                } else {
                    if (href.endsWith('/') || !href.includes('.')) {
                        navigateTo(targetPath);
                    } else {
                        handleEdit({ name: targetPath.split('/').pop() || '', path: targetPath, isDir: false, size: 0, modTime: '' });
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
                    />
                    <div className="markdown-preview">
                        <ReactMarkdown components={{ a: MarkdownLink }}>{editContent}</ReactMarkdown>
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
                            <ReactMarkdown components={{ a: MarkdownLink }}>{indexContent}</ReactMarkdown>
                            <hr />
                            <h4>Directory Listing</h4>
                            <FileList files={files} onNavigate={navigateTo} onEdit={handleEdit} onDownload={handleDownload} />
                        </div>
                    ) : (
                        <FileList files={files} onNavigate={navigateTo} onEdit={handleEdit} onDownload={handleDownload} />
                    )}
                </div>
            )}
        </div>
    );
}

function FileList({ files, onNavigate, onEdit, onDownload }: {
    files: FileItem[],
    onNavigate: (path: string) => void,
    onEdit: (file: FileItem) => void,
    onDownload: (file: FileItem) => void
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
                                    {!file.isDir && (
                                        <button onClick={() => onDownload(file)} className="btn-icon" title="Download">
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
