import { useCallback, useEffect, useState } from 'react';
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

// The ETag header comes wrapped in quotes per RFC; strip them for use in URLs.
function normalizeEtag(raw: string | null): string | null {
  if (!raw) return null;
  return raw.replace(/^"/, '').replace(/"$/, '');
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
  // ETag of the file state the preview currently reflects. Drives the image
  // cache-bust query param and the HEAD-diff check on tab revisit.
  const [etag, setEtag] = useState<string | null>(null);

  const loadText = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(fileUrl);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      setEtag(r.headers.get('etag'));
      const data = (await r.json()) as { content: string; language: string };
      setContent(data.content);
      setLanguage(data.language);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [fileUrl]);

  // HEAD with cache:'no-store' so the browser itself doesn't serve us a stale
  // ETag and hide real file changes from the diff check.
  const fetchEtag = useCallback(async (): Promise<string | null> => {
    try {
      const r = await fetch(fileUrl, { method: 'HEAD', cache: 'no-store' });
      if (r.ok) return r.headers.get('etag');
    } catch { /* ignore */ }
    return null;
  }, [fileUrl]);

  // Initial load. For text we need the body; for images we only need the ETag
  // so the <img> URL carries the correct cache-busting version from the start.
  useEffect(() => {
    setEtag(null);
    if (isImage) {
      fetchEtag().then((e) => { if (e) setEtag(e); });
    } else {
      loadText();
    }
  }, [fileUrl, isImage, loadText, fetchEtag]);

  // Manual refresh. Text: refetch content unconditionally. Image: refresh the
  // ETag; if it changed, the src changes and the browser refetches. If the
  // file hasn't actually changed, we intentionally keep the cached image.
  const handleRefresh = useCallback(async () => {
    if (isImage) {
      const e = await fetchEtag();
      if (e) setEtag(e);
    } else {
      await loadText();
    }
  }, [isImage, loadText, fetchEtag]);

  // Auto-refresh on tab revisit, but only when the file actually changed.
  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      const newEtag = await fetchEtag();
      if (!newEtag || newEtag === etag) return;
      setEtag(newEtag);
      if (!isImage) await loadText();
      // For images, the etag change above flips the <img> src and the
      // browser refetches on its own.
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [etag, isImage, loadText, fetchEtag]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
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
    const cacheKey = normalizeEtag(etag);
    return (
      <div className="file-viewer">
        <div className="file-viewer-header">
          <span className="file-viewer-path">{filePath}</span>
          <span className="file-viewer-lang">{ext}</span>
          <button
            className="file-viewer-copy"
            onClick={handleRefresh}
            title="Reload image from disk"
          >
            Refresh
          </button>
        </div>
        <div className="file-viewer-content file-viewer-content-image">
          {cacheKey ? (
            <img
              className="file-viewer-image"
              src={`${fileUrl}&v=${encodeURIComponent(cacheKey)}`}
              alt={filePath}
              onError={() => setError('failed to load image')}
            />
          ) : (
            <div className="file-viewer-loading">Loading...</div>
          )}
          {error && <div className="file-viewer-error">{error}</div>}
        </div>
      </div>
    );
  }

  if (loading && !content) {
    return (
      <div className="file-viewer">
        <div className="file-viewer-loading">Loading...</div>
      </div>
    );
  }

  if (error && !content) {
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
          onClick={handleRefresh}
          title="Reload file from disk"
        >
          Refresh
        </button>
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
