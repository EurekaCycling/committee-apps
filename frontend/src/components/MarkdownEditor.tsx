import type { ClipboardEvent } from 'react';
import { MarkdownViewer } from './MarkdownViewer';
import type { MarkdownViewerProps } from './MarkdownViewer';

interface MarkdownEditorProps {
    value: string;
    onChange: (value: string) => void;
    onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
    viewerProps: Omit<MarkdownViewerProps, 'content'>;
}

export function MarkdownEditor({ value, onChange, onPaste, viewerProps }: MarkdownEditorProps) {
    return (
        <div className="editor-container">
            <textarea
                className="markdown-editor"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onPaste={onPaste}
            />
            <div className="markdown-preview">
                <MarkdownViewer content={value} {...viewerProps} />
            </div>
        </div>
    );
}
