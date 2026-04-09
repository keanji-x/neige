import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecentFile } from '../hooks/useConfig';

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface DisplayItem {
  name: string;
  /** For recent files: absolute path; for search results: relative path */
  path: string;
  isRecent: boolean;
  /** Absolute path used when opening */
  fullPath: string;
}

interface FilePickerProps {
  open: boolean;
  onClose: () => void;
  onOpenFile: (path: string, name: string) => void;
  searchRoot: string;
  recentFiles: RecentFile[];
}

export function FilePicker({ open, onClose, onOpenFile, searchRoot, recentFiles }: FilePickerProps) {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSearchResults([]);
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, searchRoot]);

  const fetchFiles = useCallback(async (q: string) => {
    if (!searchRoot) return;
    setLoading(true);
    try {
      const url = `/api/files?path=${encodeURIComponent(searchRoot)}${q ? `&query=${encodeURIComponent(q)}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const data: FileEntry[] = await res.json();
        setSearchResults(data);
        setSelected(0);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [searchRoot]);

  const handleChange = (value: string) => {
    setQuery(value);
    clearTimeout(timerRef.current);
    if (value.trim()) {
      timerRef.current = setTimeout(() => fetchFiles(value), 150);
    } else {
      setSearchResults([]);
      setSelected(0);
    }
  };

  // Build display list: recent files first (filtered by query), then search results
  const buildDisplayList = (): DisplayItem[] => {
    const items: DisplayItem[] = [];
    const lq = query.toLowerCase();
    const seenPaths = new Set<string>();

    // Recent files (always shown at top, filtered by query)
    const filteredRecent = recentFiles.filter((f) =>
      !lq || f.name.toLowerCase().includes(lq) || f.path.toLowerCase().includes(lq)
    );
    for (const f of filteredRecent) {
      seenPaths.add(f.path);
      items.push({
        name: f.name,
        path: f.path,
        isRecent: true,
        fullPath: f.path,
      });
    }

    // Search results (deduplicated against recent files)
    for (const f of searchResults) {
      const fullPath = `${searchRoot}/${f.path}`;
      if (seenPaths.has(fullPath)) continue;
      items.push({
        name: f.name,
        path: f.path,
        isRecent: false,
        fullPath,
      });
    }

    return items;
  };

  const displayList = buildDisplayList();

  const handleSelect = (item: DisplayItem) => {
    onOpenFile(item.fullPath, item.name);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((prev) => Math.min(prev + 1, displayList.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && displayList.length > 0) {
      e.preventDefault();
      handleSelect(displayList[selected]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    const el = document.querySelector('.file-picker-item.selected');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!open) return null;

  const extIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (['md', 'markdown'].includes(ext)) return '\u{1F4DD}';
    if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) return '\u{1F7E8}';
    if (['rs'].includes(ext)) return '\u{1F9E1}';
    if (['py'].includes(ext)) return '\u{1F40D}';
    if (['json', 'toml', 'yaml', 'yml'].includes(ext)) return '\u{2699}';
    if (['css', 'html'].includes(ext)) return '\u{1F3A8}';
    return '\u{1F4C4}';
  };

  // Check if we have recent items in the display to show a section header
  const hasRecent = displayList.some((d) => d.isRecent);
  const hasSearch = displayList.some((d) => !d.isRecent);
  let globalIdx = 0;

  return (
    <div className="file-picker-overlay" onClick={onClose}>
      <div className="file-picker" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="file-picker-input-row">
          <span className="file-picker-icon">{'\u{1F50D}'}</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Search files by name..."
            className="file-picker-input"
          />
          {loading && <span className="file-picker-loading" />}
        </div>
        <div className="file-picker-results">
          {displayList.length === 0 && !loading && (
            <div className="file-picker-empty">
              {query ? 'No files found' : 'No recent files. Type to search...'}
            </div>
          )}
          {hasRecent && (
            <div className="file-picker-section-label">Recent files</div>
          )}
          {displayList.filter((d) => d.isRecent).map((item) => {
            const idx = globalIdx++;
            return (
              <button
                key={`recent:${item.fullPath}`}
                className={`file-picker-item ${idx === selected ? 'selected' : ''}`}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelected(idx)}
              >
                <span className="file-picker-item-icon">{extIcon(item.name)}</span>
                <span className="file-picker-item-name">{item.name}</span>
                <span className="file-picker-item-badge">recent</span>
                <span className="file-picker-item-path">{item.path.replace(/^\/home\/[^/]+/, '~')}</span>
              </button>
            );
          })}
          {hasRecent && hasSearch && (
            <div className="file-picker-section-label">Files</div>
          )}
          {displayList.filter((d) => !d.isRecent).map((item) => {
            const idx = globalIdx++;
            return (
              <button
                key={`search:${item.path}`}
                className={`file-picker-item ${idx === selected ? 'selected' : ''}`}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelected(idx)}
              >
                <span className="file-picker-item-icon">{extIcon(item.name)}</span>
                <span className="file-picker-item-name">{item.name}</span>
                <span className="file-picker-item-path">{item.path}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
