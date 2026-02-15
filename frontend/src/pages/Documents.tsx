import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FaEdit, FaChevronLeft, FaSave, FaUpload, FaTimes, FaPlus } from 'react-icons/fa';
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

const isImageFile = (file: File): boolean => {
    if (file.type.startsWith('image/')) return true;
    return /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
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
    const [isNewPage, setIsNewPage] = useState(false);
    const [newPageName, setNewPageName] = useState('');
    const [viewingFile, setViewingFile] = useState<FileItem | null>(null);
    const [viewContent, setViewContent] = useState('');
    const isLoading = loading || fileListLoading;
    const newPageInputRef = useRef<HTMLInputElement>(null);

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
        if (!isNewPage || !newPageInputRef.current) return;
        newPageInputRef.current.focus();
        newPageInputRef.current.select();
    }, [isNewPage]);


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
        setIsNewPage(false);
        setNewPageName('');
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

    const uploadFileToCurrentPath = async (file: File) => {
        const uploadPath = joinPath(currentPath, file.name);
        await putToS3(uploadPath, await file.arrayBuffer(), file.type || 'application/octet-stream');
    };

    const handleSave = async () => {
        if (!editingFile) return;
        let savePath = editingFile.path;
        if (isNewPage) {
            const trimmedName = newPageName.trim();
            if (!trimmedName) {
                alert('Please enter a filename.');
                newPageInputRef.current?.focus();
                newPageInputRef.current?.select();
                return;
            }
            const resolvedName = trimmedName.endsWith('.md') ? trimmedName : `${trimmedName}.md`;
            savePath = joinPath(currentPath, resolvedName);
        }
        setLoading(true);
        try {
            await putToS3(savePath, editContent, 'text/markdown');
            setDocumentParams(currentPath);
            setEditingFile(null);
            setIsNewPage(false);
            setNewPageName('');
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
            await uploadFileToCurrentPath(file);
            fetchFiles(currentPath);
        } catch (err: any) {
            alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handlePageDrop = async (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const droppedFiles = Array.from(event.dataTransfer.files || []);
        if (!droppedFiles.length) return;

        setLoading(true);
        try {
            for (const file of droppedFiles) {
                await uploadFileToCurrentPath(file);
            }
            fetchFiles(currentPath);
        } catch (err: any) {
            alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleEditorDrop = async (event: React.DragEvent<HTMLTextAreaElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const droppedFiles = Array.from(event.dataTransfer.files || []);
        if (!droppedFiles.length) return;

        const textarea = event.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;

        setLoading(true);
        try {
            const snippets: string[] = [];
            for (const file of droppedFiles) {
                await uploadFileToCurrentPath(file);
                const markdown = isImageFile(file)
                    ? `![${file.name}](${file.name})`
                    : `[${file.name}](${file.name})`;
                snippets.push(markdown);
            }

            const text = textarea.value;
            const before = text.substring(0, start);
            const after = text.substring(end);
            const insertText = `\n${snippets.join('\n')}\n`;
            const newContent = before + insertText + after;

            setEditContent(newContent);
            fetchFiles(currentPath);

            setTimeout(() => {
                textarea.focus();
                const newPos = start + insertText.length;
                textarea.setSelectionRange(newPos, newPos);
            }, 0);
        } catch (err: any) {
            alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handlePageDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
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

    const createFolder = async (name: string): Promise<boolean> => {
        const trimmedName = name.trim();
        if (!trimmedName) return false;
        const path = joinPath(currentPath, trimmedName);
        setLoading(true);
        try {
            const res = await apiFetch(`/documents/mkdir?path=${encodeURIComponent(path)}`, {
                method: 'POST'
            });
            if (!res.ok) throw new Error('Failed to create folder');
            fetchFiles(currentPath);
            return true;
        } catch (err: any) {
            alert(err.message);
            return false;
        } finally {
            setLoading(false);
        }
    };

    const createMarkdown = () => {
        setDocumentParams(currentPath);
        setViewingFile(null);
        setViewContent('');
        setIsNewPage(true);
        setNewPageName('');
        setEditingFile({ name: 'untitled.md', path: joinPath(currentPath, 'untitled.md'), isDir: false, size: 0, modTime: '' });
        setEditContent('# New Page\n\nContent here...');
    };

    const renderBreadcrumbs = () => (
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
            {isNewPage && (
                <span>
                    {' / '}
                    <input
                        ref={newPageInputRef}
                        type="text"
                        value={newPageName}
                        onChange={(event) => setNewPageName(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                handleSave();
                            }
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                setDocumentParams(currentPath);
                                setEditingFile(null);
                                setIsNewPage(false);
                                setNewPageName('');
                            }
                        }}
                        placeholder="Untitled"
                        aria-label="New page filename"
                    />
                </span>
            )}
        </div>
    );

    if (editingFile) {
        return (
            <div className="page-container" onDrop={handlePageDrop} onDragOver={handlePageDragOver}>
                <div className="docs-header">
                    {renderBreadcrumbs()}
                    <h2>Editing: {isNewPage ? (newPageName || 'Untitled') : editingFile.name}</h2>
                    <div className="docs-actions">
                        <button onClick={() => { setDocumentParams(currentPath); setEditingFile(null); setIsNewPage(false); setNewPageName(''); }} className="btn-secondary">
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
                    onDrop={handleEditorDrop}
                    onDragOver={(event) => event.preventDefault()}
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
            <div className="page-container" onDrop={handlePageDrop} onDragOver={handlePageDragOver}>
                <div className="docs-header">
                    {renderBreadcrumbs()}
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
            <div className="page-container" onDrop={handlePageDrop} onDragOver={handlePageDragOver}>
            <div className="docs-header">
                {renderBreadcrumbs()}
                <div className="docs-actions">
                    <button onClick={createMarkdown} className="btn-outline">
                        <FaPlus /> New Page
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
                            <FileList
                                files={files}
                                onNavigate={navigateTo}
                                onView={handleView}
                                onCreateFolder={createFolder}
                            />
                        </div>
                    ) : (
                        <FileList
                            files={files}
                            onNavigate={navigateTo}
                            onView={handleView}
                            onCreateFolder={createFolder}
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
