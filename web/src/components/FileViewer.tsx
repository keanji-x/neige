import { useEffect, useState } from 'react';
import { marked } from 'marked';

interface FileViewerProps {
  filePath: string;
}

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'apng',
]);

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  if (i < 0) return '';
  return path.slice(i + 1).toLowerCase();
}

export function FileViewer({ filePath }: FileViewerProps) {
  const ext = extOf(filePath);
  const isImage = IMAGE_EXTS.has(ext);
  const fileUrl = `/api/file?path=${encodeURIComponent(filePath)}`;

  const [content, setContent] = useState('');
  const [language, setLanguage] = useState('text');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!isImage);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isImage) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(fileUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((data: { content: string; language: string }) => {
        if (cancelled) return;
        setContent(data.content);
        setLanguage(data.language);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [fileUrl, isImage]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for non-secure contexts
      const ta = document.createElement('textarea');
      ta.value = content;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
  };

  if (isImage) {
    return (
      <div className="file-viewer">
        <div className="file-viewer-header">
          <span className="file-viewer-path">{filePath}</span>
          <span className="file-viewer-lang">{ext}</span>
        </div>
        <div className="file-viewer-content file-viewer-content-image">
          <img
            className="file-viewer-image"
            src={fileUrl}
            alt={filePath}
            onError={() => setError('failed to load image')}
          />
          {error && <div className="file-viewer-error">{error}</div>}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="file-viewer">
        <div className="file-viewer-loading">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="file-viewer">
        <div className="file-viewer-error">Failed to load file: {error}</div>
      </div>
    );
  }

  const isMarkdown = language === 'markdown';

  return (
    <div className="file-viewer">
      <div className="file-viewer-header">
        <span className="file-viewer-path">{filePath}</span>
        <span className="file-viewer-lang">{language}</span>
        <button
          className="file-viewer-copy"
          onClick={handleCopy}
          title="Copy full contents"
          disabled={!content}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="file-viewer-content">
        {isMarkdown ? (
          <div
            className="file-viewer-markdown"
            dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }}
          />
        ) : (
          <pre className="file-viewer-code">
            <code>{content}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
