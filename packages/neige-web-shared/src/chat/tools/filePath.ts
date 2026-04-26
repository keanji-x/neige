// Path-display helpers shared by the file-op tool cards. Path noise dominates
// many tool cards (long absolute paths repeat the same prefix); shortenPath
// trims the head down to the last few segments so the basename — the part the
// user actually scans for — never gets clipped.

export function shortenPath(p: string, max = 64): string {
  if (typeof p !== 'string' || p.length === 0) return p ?? '';
  if (p.length <= max) return p;

  // Split into segments, dropping the empty leading entry that absolute paths
  // produce (e.g. "/a/b" -> ["", "a", "b"]). We re-join without a leading "/"
  // because the "…/" prefix replaces it.
  const parts = p.split('/').filter((s) => s.length > 0);
  if (parts.length <= 2) {
    // Only a basename (or one parent + basename) fits the path; head-truncate
    // the basename itself so we still respect `max`.
    const base = parts[parts.length - 1] ?? p;
    if (base.length <= max - 2) return `…/${base}`;
    return `…${base.slice(base.length - (max - 1))}`;
  }

  const tail = `…/${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  if (tail.length <= max) return tail;

  // Even last 2 segments + "…/" exceed max — fall back to head-truncating the
  // basename only.
  const base = parts[parts.length - 1];
  if (base.length <= max - 2) return `…/${base}`;
  return `…${base.slice(base.length - (max - 1))}`;
}

export function lineCount(text: string): number {
  if (typeof text !== 'string' || text.length === 0) return 0;
  // Count "\n"; a trailing newline does not add a phantom blank line, and a
  // file with no trailing newline still counts its last line.
  let n = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  // If the very last char is "\n", we over-counted by one.
  if (text.charCodeAt(text.length - 1) === 10) n--;
  return n;
}
