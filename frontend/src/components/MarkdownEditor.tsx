import type { ClipboardEvent, DragEvent } from 'react';
import { MarkdownViewer } from './MarkdownViewer';
import type { MarkdownViewerProps } from './MarkdownViewer';

interface MarkdownEditorProps {
    value: string;
    onChange: (value: string) => void;
    onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
    onDrop?: (event: DragEvent<HTMLTextAreaElement>) => void;
    onDragOver?: (event: DragEvent<HTMLTextAreaElement>) => void;
    viewerProps: Omit<MarkdownViewerProps, 'content'>;
}

export function MarkdownEditor({ value, onChange, onPaste, onDrop, onDragOver, viewerProps }: MarkdownEditorProps) {
    return (
        <div className="editor-container">
            <textarea
                className="markdown-editor"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onPaste={onPaste}
                onDrop={onDrop}
                onDragOver={onDragOver}
            />
            <div className="markdown-preview">
                <MarkdownViewer content={value} {...viewerProps} />
            </div>
        </div>
    );
}
