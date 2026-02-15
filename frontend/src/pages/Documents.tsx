import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FaFolder, FaEdit, FaChevronLeft, FaSave, FaUpload, FaTimes, FaPlus } from 'react-icons/fa';
import { apiFetch } from '../api';
import { FileList } from '../components/FileList/List.tsx';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { MarkdownViewer } from '../components/MarkdownViewer';
import { usePageTitle } from '../hooks/usePageTitle';
import { useAppConfig } from '../providers/ConfigProvider';
import { FileListProvider, useFileList, type FileItem } from '../providers/FileListProvider';
import './Documents.css';

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

const joinPath = (base: string, name: string): string => {
    if (!base) return name;
    const trimmedBase = base.replace(/\/+$/, '');
    const trimmedName = name.replace(/^\/+/, '');
    return `${trimmedBase}/${trimmedName}`;
};

function DocumentsContent() {
    const { config } = useAppConfig();
    const [searchParams, setSearchParams] = useSearchParams();
    const currentPath = searchParams.get('path') || '';
    const currentFile = searchParams.get('file') || '';
    const {
        files,
        error,
        fetchFiles,
        indexContent,
        isLoading: fileListLoading
    } = useFileList();

    // Helper to update path in URL
    const setDocumentParams = (path: string, file?: string) => {
        const params: Record<string, string> = {};
        if (path) params.path = path;
        if (file) params.file = file;
        setSearchParams(params);
    };

    const [loading, setLoading] = useState(false);
    const [editingFile, setEditingFile] = useState<FileItem | null>(null);
    const [editContent, setEditContent] = useState('');
    const [viewingFile, setViewingFile] = useState<FileItem | null>(null);
    const [viewContent, setViewContent] = useState('');
    const isLoading = loading || fileListLoading;

    // Set page title: H1 from editor > filename > H1 from view > H1 from index > folder name > "Documents"
    const title = (editingFile ? (extractH1(editContent) || editingFile.name)
        : viewingFile ? (extractH1(viewContent) || viewingFile.name)
            : (indexContent ? extractH1(indexContent) : null))
        || (currentPath.split('/').filter(Boolean).pop() || 'Documents');
    usePageTitle(title);

    const loadMarkdown = async (file: FileItem) => {
        const res = await apiFetch(`/documents/view?path=${encodeURIComponent(file.path)}`);
        if (!res.ok) throw new Error('Failed to load file');
        const base64 = await res.text();
        return atob(base64);
    };

    useEffect(() => {
        fetchFiles(currentPath);
    }, [currentPath, fetchFiles]);


    useEffect(() => {
        if (!currentFile) {
            setViewingFile(null);
            setViewContent('');
            return;
        }

        const targetPath = joinPath(currentPath, currentFile);
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
        const resolvedContentType = contentType || 'application/octet-stream';
        const presignRes = await apiFetch(`/documents/upload/presign?path=${encodeURIComponent(path)}&contentType=${encodeURIComponent(resolvedContentType)}`);
        if (!presignRes.ok) {
            throw new Error('Failed to get upload URL');
        }
        const presignData = await presignRes.json() as { url: string };
        const res = await fetch(presignData.url, {
            method: 'PUT',
            headers: {
                'Content-Type': resolvedContentType
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
            const uploadPath = joinPath(currentPath, file.name);
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
                    const uploadPath = joinPath(currentPath, filename);
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
            const path = joinPath(currentPath, name);
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
            const path = joinPath(currentPath, fileName);
            setViewingFile(null);
            setViewContent('');
            setEditingFile({ name: fileName, path, isDir: false, size: 0, modTime: '' });
            setEditContent('# ' + fileName + '\n\nContent here...');
        }
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
                        <button onClick={handleSave} className="btn-primary" disabled={isLoading}>
                            <FaSave /> Save
                        </button>
                    </div>
                </div>
                <MarkdownEditor
                    value={editContent}
                    onChange={setEditContent}
                    onPaste={handlePaste}
                    viewerProps={{
                        currentPath,
                        files,
                        getFileUrl,
                        navigateTo,
                        onView: handleView,
                        onFileAction: handleFileAction,
                        isViewable
                    }}
                />
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
                {isLoading && <div className="loading">Loading...</div>}
                {!isLoading && (
                    <div className="docs-content">
                        <div className="markdown-view card">
                            <MarkdownViewer
                                content={viewContent}
                                currentPath={currentPath}
                                files={files}
                                getFileUrl={getFileUrl}
                                navigateTo={navigateTo}
                                onView={handleView}
                                onFileAction={handleFileAction}
                                isViewable={isViewable}
                            />
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

            {isLoading && <div className="loading">Loading...</div>}
            {error && <div className="error-card">{error}</div>}

            {!isLoading && !error && (
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
                            <MarkdownViewer
                                content={indexContent}
                                currentPath={currentPath}
                                files={files}
                                getFileUrl={getFileUrl}
                                navigateTo={navigateTo}
                                onView={handleView}
                                onFileAction={handleFileAction}
                                isViewable={isViewable}
                            />
                            <hr />
                            <h4>Directory Listing</h4>
                            <FileList
                                files={files}
                                onNavigate={navigateTo}
                                onView={handleView}
                            />
                        </div>
                    ) : (
                        <FileList
                            files={files}
                            onNavigate={navigateTo}
                            onView={handleView}
                        />
                    )}
                </div>
            )}
        </div>
    );
}

export function Documents() {
    return (
        <FileListProvider>
            <DocumentsContent />
        </FileListProvider>
    );
}
