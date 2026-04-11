import { useState, useCallback, useRef, useEffect } from 'react';

interface WebViewProps {
  url: string;
}

export function WebView({ url }: WebViewProps) {
  const [currentUrl, setCurrentUrl] = useState(url);
  const [inputUrl, setInputUrl] = useState(url);
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync when prop changes
  useEffect(() => {
    setCurrentUrl(url);
    setInputUrl(url);
  }, [url]);

  const proxyUrl = useCallback((raw: string) => {
    return `/api/proxy?url=${encodeURIComponent(raw)}`;
  }, []);

  const navigate = useCallback((raw: string) => {
    let dest = raw.trim();
    if (!dest) return;
    // Auto-add https:// if missing
    if (!dest.startsWith('http://') && !dest.startsWith('https://')) {
      dest = 'https://' + dest;
    }
    setCurrentUrl(dest);
    setInputUrl(dest);
    setLoading(true);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        navigate(inputUrl);
      }
    },
    [inputUrl, navigate],
  );

  const handleRefresh = useCallback(() => {
    setLoading(true);
    if (iframeRef.current) {
      iframeRef.current.src = proxyUrl(currentUrl);
    }
  }, [currentUrl, proxyUrl]);

  return (
    <div className="webview">
      <div className="webview-toolbar">
        <button
          className="webview-btn"
          onClick={handleRefresh}
          title="Refresh"
        >
          &#8635;
        </button>
        <input
          ref={inputRef}
          className="webview-url-input"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={(e) => e.target.select()}
          spellCheck={false}
          placeholder="Enter URL..."
        />
        <button
          className="webview-btn"
          onClick={() => navigate(inputUrl)}
          title="Go"
        >
          &#10132;
        </button>
      </div>
      <div className="webview-content">
        {loading && <div className="webview-loading">Loading...</div>}
        <iframe
          ref={iframeRef}
          className="webview-iframe"
          src={proxyUrl(currentUrl)}
          onLoad={() => setLoading(false)}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          title="Web View"
        />
      </div>
    </div>
  );
}
