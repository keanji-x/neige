import { useEffect, useState } from 'react';
import { marked } from 'marked';

interface FileViewerProps {
  filePath: string;
}

export function FileViewer({ filePath }: FileViewerProps) {
  const [content, setContent] = useState('');
  const [language, setLanguage] = useState('text');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/file?path=${encodeURIComponent(filePath)}`)
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
  }, [filePath]);

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
