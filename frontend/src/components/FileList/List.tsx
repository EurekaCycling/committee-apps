import {FaEdit, FaEye, FaFileAlt, FaUpload} from "react-icons/fa";

interface FileItem {
    url?: string;
    name: string;
    path: string;
    isDir: boolean;
    size: number;
    modTime: string;
    token?: string;
    expires?: number;
}

interface FileListProps {
    files: FileItem[];
    onNavigate: (path: string) => void;
    onEdit: (file: FileItem) => void;
    onView: (file: FileItem) => void;
    onFileAction: (file: FileItem, mode: 'download' | 'view') => void;
    getFileUrl: (file: FileItem) => string;
    isViewable: (filename: string) => boolean;
}

interface ItemProps {
    file: FileItem;
    onNavigate: (path: string) => void;
    onEdit: (file: FileItem) => void;
    onView: (file: FileItem) => void;
    onFileAction: (file: FileItem, mode: 'download' | 'view') => void;
    getFileUrl: (file: FileItem) => string;
    isViewable: (filename: string) => boolean;
}

function Item({ file, onNavigate, onEdit, onView, onFileAction, getFileUrl, isViewable }: ItemProps) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const isDir = file.isDir;
    const isRelative = isDir || ext == 'md';
    const href = isRelative ? `documents?path=${file.name}` : file.url;
    const attrs: React.DetailedHTMLProps<React.AnchorHTMLAttributes<HTMLAnchorElement>, HTMLAnchorElement> = isRelative ? {
        onClick: (e) => {
            e.preventDefault();
            if (isDir) {
                onNavigate(file.path)
            } else {
                onView(file)
            }
        }
    } : {};

    return <tr key={file.path}>
        <td>
            <a
                href={href}
                className="btn-link"
                {...attrs}
            >
                <FaFileAlt className="icon-file"/>
                {file.name}
            </a>
        </td>
        <td>{file.isDir ? '-' : formatSize(file.size)}</td>
        <td>{file.modTime ? new Date(file.modTime).toLocaleDateString() : '-'}</td>
        <td>
            {!file.isDir && file.name.endsWith('.md') && (
                <button onClick={() => onEdit(file)} className="btn-icon" title="Edit">
                    <FaEdit/>
                </button>
            )}
            {!file.isDir && isViewable(file.name) && (
                getFileUrl(file) ? (
                    <a href={getFileUrl(file)} target="_blank" rel="noreferrer" className="btn-icon"
                       title="View in new tab">
                        <FaEye/>
                    </a>
                ) : (
                    <button onClick={() => onFileAction(file, 'view')} className="btn-icon"
                            title="View in new tab">
                        <FaEye/>
                    </button>
                )
            )}
            {!file.isDir && (
                getFileUrl(file) ? (
                    <a href={getFileUrl(file)} download={file.name} className="btn-icon"
                       title="Download">
                        <FaUpload style={{transform: 'rotate(180deg)'}}/>
                    </a>
                ) : (
                    <button onClick={() => onFileAction(file, 'download')} className="btn-icon"
                            title="Download">
                        <FaUpload style={{transform: 'rotate(180deg)'}}/>
                    </button>
                )
            )}
        </td>
    </tr>
    ;
}

export function FileList({
                             files,
                             onNavigate,
                             onEdit,
                             onView,
                             onFileAction,
                             getFileUrl,
                             isViewable
                         }: FileListProps) {

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
                        <Item
                            key={file.path}
                            file={file}
                            onNavigate={onNavigate}
                            onEdit={onEdit}
                            onView={onView}
                            onFileAction={onFileAction}
                            getFileUrl={getFileUrl}
                            isViewable={isViewable}
                        />
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
