import {FaFileAlt} from "react-icons/fa";

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
    onView: (file: FileItem) => void;
}

interface ItemProps {
    file: FileItem;
    onNavigate: (path: string) => void;
    onView: (file: FileItem) => void;
}

function Item({ file, onNavigate, onView }: ItemProps) {
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
    </tr>
    ;
}

export function FileList({
                              files,
                              onNavigate,
                              onView
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
                            onView={onView}
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
