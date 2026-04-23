import { useCallback, useEffect, useState } from 'react';
import { marked } from 'marked';
import { authedFetch, fileUrl as buildFileUrl } from '../api';

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
  const fileUrl = buildFileUrl(filePath);

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
      const r = await authedFetch(fileUrl);
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
      const r = await authedFetch(fileUrl, { method: 'HEAD', cache: 'no-store' });
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
      <div className="w-full h-full flex flex-col bg-bg-primary overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg-secondary flex-shrink-0">
          <span className="flex-1 min-w-0 font-mono text-xs text-text-muted whitespace-nowrap overflow-hidden text-ellipsis">
            {filePath}
          </span>
          <span className="text-xs text-blue bg-blue-dim px-2 py-0.5 rounded-[3px] uppercase tracking-[0.05em] flex-shrink-0">
            {ext}
          </span>
          <button
            className="flex-shrink-0 text-xs font-sans text-text-muted bg-transparent border border-border rounded-[3px] px-2 py-0.5 cursor-pointer leading-[1.4] transition-colors hover:text-text-primary hover:border-text-muted hover:bg-bg-primary disabled:opacity-40 disabled:cursor-default"
            onClick={handleRefresh}
            title="Reload image from disk"
          >
            Refresh
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-bg-secondary">
          {cacheKey ? (
            <img
              className="max-w-full max-h-full object-contain"
              src={`${fileUrl}&v=${encodeURIComponent(cacheKey)}`}
              alt={filePath}
              onError={() => setError('failed to load image')}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted text-base">
              Loading...
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-full text-red text-base">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (loading && !content) {
    return (
      <div className="w-full h-full flex flex-col bg-bg-primary overflow-hidden">
        <div className="flex items-center justify-center h-full text-text-muted text-base">
          Loading...
        </div>
      </div>
    );
  }

  if (error && !content) {
    return (
      <div className="w-full h-full flex flex-col bg-bg-primary overflow-hidden">
        <div className="flex items-center justify-center h-full text-red text-base">
          Failed to load file: {error}
        </div>
      </div>
    );
  }

  const isMarkdown = language === 'markdown';

  return (
    <div className="w-full h-full flex flex-col bg-bg-primary overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg-secondary flex-shrink-0">
        <span className="flex-1 min-w-0 font-mono text-xs text-text-muted whitespace-nowrap overflow-hidden text-ellipsis">
          {filePath}
        </span>
        <span className="text-xs text-blue bg-blue-dim px-2 py-0.5 rounded-[3px] uppercase tracking-[0.05em] flex-shrink-0">
          {language}
        </span>
        <button
          className="flex-shrink-0 text-xs font-sans text-text-muted bg-transparent border border-border rounded-[3px] px-2 py-0.5 cursor-pointer leading-[1.4] transition-colors hover:text-text-primary hover:border-text-muted hover:bg-bg-primary disabled:opacity-40 disabled:cursor-default"
          onClick={handleRefresh}
          title="Reload file from disk"
        >
          Refresh
        </button>
        <button
          className="flex-shrink-0 text-xs font-sans text-text-muted bg-transparent border border-border rounded-[3px] px-2 py-0.5 cursor-pointer leading-[1.4] transition-colors hover:text-text-primary hover:border-text-muted hover:bg-bg-primary disabled:opacity-40 disabled:cursor-default"
          onClick={handleCopy}
          title="Copy full contents"
          disabled={!content}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {isMarkdown ? (
          <div
            className="file-viewer-markdown"
            dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }}
          />
        ) : (
          <pre
            className="m-0 font-mono text-sm leading-[1.6] text-text-primary whitespace-pre-wrap break-words"
            style={{ tabSize: 4 }}
          >
            <code className="font-[inherit]">{content}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
