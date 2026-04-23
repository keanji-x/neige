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
    <div className="flex flex-col h-full bg-[#1a1a2e]">
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-bg-secondary border-b border-border flex-shrink-0">
        <button
          className="bg-bg-tertiary border border-border text-text-secondary rounded w-7 h-7 cursor-pointer flex items-center justify-center text-sm flex-shrink-0 hover:bg-bg-hover hover:text-text-primary"
          onClick={handleRefresh}
          title="Refresh"
        >
          &#8635;
        </button>
        <input
          ref={inputRef}
          className="flex-1 bg-bg-primary border border-border text-text-primary px-2.5 py-1 rounded-[14px] text-sm font-[inherit] outline-none h-7 focus:border-blue"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={(e) => e.target.select()}
          spellCheck={false}
          placeholder="Enter URL..."
        />
        <button
          className="bg-bg-tertiary border border-border text-text-secondary rounded w-7 h-7 cursor-pointer flex items-center justify-center text-sm flex-shrink-0 hover:bg-bg-hover hover:text-text-primary"
          onClick={() => navigate(inputUrl)}
          title="Go"
        >
          &#10132;
        </button>
      </div>
      <div className="flex-1 relative min-h-0">
        {loading && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-text-secondary text-base z-[1]">
            Loading...
          </div>
        )}
        <iframe
          ref={iframeRef}
          className="w-full h-full border-none bg-white"
          src={proxyUrl(currentUrl)}
          onLoad={() => setLoading(false)}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          title="Web View"
        />
      </div>
    </div>
  );
}
