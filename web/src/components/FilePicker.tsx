import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Dialog, DialogContent } from '@neige/shared';
import { searchFiles, type FileSearchEntry } from '../api';
import type { RecentFile } from '../hooks/useConfig';

type FileEntry = FileSearchEntry;

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
      // Focus is handled via DialogContent#onOpenAutoFocus below.
    }
  }, [open, searchRoot]);

  const fetchFiles = useCallback(async (q: string) => {
    if (!searchRoot) return;
    setLoading(true);
    try {
      const data = await searchFiles(searchRoot, q || undefined);
      setSearchResults(data);
      setSelected(0);
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

    // Recent files (always shown at top, filtered by query).
    // Prioritize entries under the active session's cwd so the picker stays
    // scoped to "stuff I opened from this project" even when the global
    // recent list spans multiple repos.
    const filteredRecent = recentFiles.filter((f) =>
      !lq || f.name.toLowerCase().includes(lq) || f.path.toLowerCase().includes(lq)
    );
    const isUnderRoot = (p: string) =>
      !!searchRoot && (p === searchRoot || p.startsWith(searchRoot + '/'));
    // Array.sort is stable (ES2019+), so recency order is preserved within each group.
    filteredRecent.sort((a, b) => Number(isUnderRoot(b.path)) - Number(isUnderRoot(a.path)));
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
    }
    // Escape handled by Radix Dialog via onOpenChange
  };

  // Scroll selected item into view
  useEffect(() => {
    const el = document.querySelector('[data-picker-selected="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

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
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        className="max-w-xl p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
      <div
        className="flex flex-col w-full max-h-[420px] overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center px-4 py-3 border-b border-border gap-2">
          <span className="text-base flex-shrink-0 opacity-50">{'\u{1F50D}'}</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Search files by name..."
            className="flex-1 bg-transparent border-none text-text-primary text-[15px] font-sans outline-none placeholder:text-text-faint"
          />
          {loading && (
            <span className="w-[14px] h-[14px] border-2 border-border border-t-blue rounded-full animate-spin" />
          )}
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {displayList.length === 0 && !loading && (
            <div className="px-6 py-6 text-center text-text-faint text-sm">
              {query ? 'No files found' : 'No recent files. Type to search...'}
            </div>
          )}
          {hasRecent && (
            <div className="px-4 pt-1.5 pb-0.5 text-[10px] font-semibold text-text-faint uppercase tracking-[0.06em] select-none">
              Recent files
            </div>
          )}
          {displayList.filter((d) => d.isRecent).map((item) => {
            const idx = globalIdx++;
            const isSelected = idx === selected;
            return (
              <button
                key={`recent:${item.fullPath}`}
                data-picker-selected={isSelected ? 'true' : undefined}
                className={clsx(
                  'flex items-center gap-2 w-full px-4 py-2 bg-transparent border-none text-text-secondary text-sm font-sans cursor-pointer text-left transition-colors hover:bg-bg-hover hover:text-text-primary',
                  isSelected && 'bg-blue-dim text-text-primary',
                )}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelected(idx)}
              >
                <span className="text-sm flex-shrink-0">{extIcon(item.name)}</span>
                <span className="font-medium whitespace-nowrap">{item.name}</span>
                <span className="text-[9px] text-blue bg-blue-dim px-1.5 py-px rounded-[3px] flex-shrink-0 uppercase tracking-[0.04em]">
                  recent
                </span>
                <span className="font-mono text-xs text-text-faint ml-auto whitespace-nowrap overflow-hidden text-ellipsis max-w-[280px] text-right">
                  {item.path.replace(/^\/home\/[^/]+/, '~')}
                </span>
              </button>
            );
          })}
          {hasRecent && hasSearch && (
            <div className="px-4 pt-1.5 pb-0.5 text-[10px] font-semibold text-text-faint uppercase tracking-[0.06em] select-none">
              Files
            </div>
          )}
          {displayList.filter((d) => !d.isRecent).map((item) => {
            const idx = globalIdx++;
            const isSelected = idx === selected;
            return (
              <button
                key={`search:${item.path}`}
                data-picker-selected={isSelected ? 'true' : undefined}
                className={clsx(
                  'flex items-center gap-2 w-full px-4 py-2 bg-transparent border-none text-text-secondary text-sm font-sans cursor-pointer text-left transition-colors hover:bg-bg-hover hover:text-text-primary',
                  isSelected && 'bg-blue-dim text-text-primary',
                )}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelected(idx)}
              >
                <span className="text-sm flex-shrink-0">{extIcon(item.name)}</span>
                <span className="font-medium whitespace-nowrap">{item.name}</span>
                <span className="font-mono text-xs text-text-faint ml-auto whitespace-nowrap overflow-hidden text-ellipsis max-w-[280px] text-right">
                  {item.path}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      </DialogContent>
    </Dialog>
  );
}
