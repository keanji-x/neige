import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Callout,
  Card,
  Checkbox,
  Dialog,
  Flex,
  Select,
  Text,
  TextField,
} from '@radix-ui/themes';
import type { CreateConvRequest, DirEntry } from '../types';
import { browseDir, isGitRepo } from '../api';
import type { NeigeConfig, RecentCommand } from '../hooks/useConfig';

interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (req: CreateConvRequest) => void;
  config: NeigeConfig;
  onConfigUpdate: (patch: Partial<NeigeConfig>) => void;
}

const PROGRAMS = ['claude', 'bash', 'zsh', 'python3', 'node'];

export function CreateDialog({ open, onClose, onCreate, config, onConfigUpdate }: CreateDialogProps) {
  const [title, setTitle] = useState('');
  const [program, setProgram] = useState('claude');
  const [customProgram, setCustomProgram] = useState('');
  const [cwd, setCwd] = useState('');
  const [proxy, setProxy] = useState('');
  const [useWorktree, setUseWorktree] = useState(true);
  const [worktreeName, setWorktreeName] = useState('');
  const [worktreeError, setWorktreeError] = useState('');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [showBrowser, setShowBrowser] = useState(false);
  const [suggestions, setSuggestions] = useState<DirEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
  const autocompleteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cwdInputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setProgram('claude');
      setCustomProgram('');
      setCwd('');
      setProxy(config.proxy || '');
      setUseWorktree(true);
      setWorktreeName('');
      setWorktreeError('');
      setEntries([]);
      setShowBrowser(false);
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [open, config.proxy]);

  const browse = useCallback(async (path: string) => {
    try {
      const data = await browseDir(path);
      setCwd(data.path);
      setEntries(data.entries);
      setShowBrowser(true);
      setShowSuggestions(false);
      setWorktreeError('');
    } catch {
      // ignore
    }
  }, []);

  const autocomplete = useCallback(async (input: string) => {
    if (!input || input.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const lastSlash = input.lastIndexOf('/');
    const parentPath = lastSlash >= 0 ? input.substring(0, lastSlash) || '/' : '';
    const prefix = lastSlash >= 0 ? input.substring(lastSlash + 1).toLowerCase() : input.toLowerCase();
    if (!parentPath) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    try {
      const data = await browseDir(parentPath);
      const filtered = data.entries
        .filter((e) => e.is_dir && e.name.toLowerCase().startsWith(prefix))
        .slice(0, 8);
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
      setSelectedSuggestion(-1);
    } catch {
      // ignore
    }
  }, []);

  const handleCwdChange = (value: string) => {
    setCwd(value);
    setShowBrowser(false);
    clearTimeout(autocompleteTimer.current);
    autocompleteTimer.current = setTimeout(() => autocomplete(value), 200);
  };

  const applySuggestion = (name: string) => {
    const lastSlash = cwd.lastIndexOf('/');
    const parentPath = lastSlash >= 0 ? cwd.substring(0, lastSlash) : '';
    setCwd(`${parentPath}/${name}`);
    setShowSuggestions(false);
    setSuggestions([]);
    cwdInputRef.current?.focus();
  };

  const handleCwdKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Tab' && cwd) {
        e.preventDefault();
        browse(cwd);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSuggestion((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSuggestion((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (selectedSuggestion >= 0) {
        e.preventDefault();
        applySuggestion(suggestions[selectedSuggestion].name);
      } else if (suggestions.length === 1) {
        e.preventDefault();
        applySuggestion(suggestions[0].name);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const effectiveProgram =
    program === '__custom__' ? customProgram.trim() || 'claude' : program;
  const isClaudeProgram =
    effectiveProgram === 'claude' || effectiveProgram.startsWith('claude ');

  const handleSubmit = async () => {
    const effectiveTitle =
      title.trim() ||
      cwd.split('/').filter(Boolean).pop() ||
      'untitled';
    const trimmedCwd = cwd.trim();
    const trimmedWorktreeName = worktreeName.trim();

    if (useWorktree && isClaudeProgram && trimmedWorktreeName) {
      if (!/^[A-Za-z0-9._-]+$/.test(trimmedWorktreeName)) {
        setWorktreeError(
          'Worktree name can only contain letters, digits, dots, underscores, and hyphens.',
        );
        return;
      }
    }
    if (useWorktree && isClaudeProgram) {
      try {
        const ok = await isGitRepo(trimmedCwd);
        if (!ok) {
          setWorktreeError(
            'This directory is not in a git repo — worktree is unavailable. Uncheck the box or choose a git directory.',
          );
          return;
        }
      } catch {
        // fall through
      }
    }

    const proxyVal = proxy.trim();
    if (proxyVal !== (config.proxy || '')) {
      onConfigUpdate({ proxy: proxyVal || undefined });
    }
    onCreate({
      title: effectiveTitle,
      program: effectiveProgram,
      cwd: trimmedCwd,
      proxy: proxyVal || undefined,
      use_worktree: useWorktree,
      worktree_name: useWorktree && trimmedWorktreeName ? trimmedWorktreeName : undefined,
    });
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
  };

  const cwdSegments = cwd ? cwd.split('/').filter(Boolean) : [];

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Content
        maxWidth="480px"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          titleRef.current?.focus();
        }}
        onEscapeKeyDown={(e) => {
          if (showSuggestions) {
            e.preventDefault();
            setShowSuggestions(false);
          }
        }}
      >
        <div onKeyDown={handleKeyDown}>
          <Dialog.Title>New Conversation</Dialog.Title>
          <Dialog.Description size="2" color="gray" mb="4">
            Configure and launch a Claude Code session.
          </Dialog.Description>

          <Flex direction="column" gap="4">
            {(config.recentCommands?.length ?? 0) > 0 && (
              <Box>
                <Text as="div" size="1" weight="medium" color="gray" mb="2">
                  RECENT
                </Text>
                <Flex wrap="wrap" gap="2">
                  {config.recentCommands!.map((cmd: RecentCommand, i: number) => (
                    <Button
                      key={i}
                      size="1"
                      variant="soft"
                      color="gray"
                      onClick={() => {
                        setTitle(cmd.title || '');
                        setProgram(PROGRAMS.includes(cmd.program) ? cmd.program : '__custom__');
                        if (!PROGRAMS.includes(cmd.program)) setCustomProgram(cmd.program);
                        setCwd(cmd.cwd);
                        setUseWorktree(cmd.use_worktree);
                        setWorktreeError('');
                      }}
                    >
                      <Text weight="medium">{cmd.program}</Text>
                      <Text color="gray" style={{ fontFamily: 'var(--code-font-family)' }}>
                        {cmd.cwd ? cmd.cwd.replace(/^\/home\/[^/]+/, '~') : 'default'}
                      </Text>
                    </Button>
                  ))}
                </Flex>
              </Box>
            )}

            <Box>
              <Text as="label" size="2" weight="medium" mb="1" style={{ display: 'block' }}>
                Title
              </Text>
              <TextField.Root
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  cwd
                    ? cwd.split('/').filter(Boolean).pop() || ''
                    : 'Auto from directory name'
                }
              />
            </Box>

            <Box>
              <Text as="label" size="2" weight="medium" mb="1" style={{ display: 'block' }}>
                Program
              </Text>
              <Flex gap="2">
                <Box style={{ flex: 1 }}>
                  <Select.Root
                    value={PROGRAMS.includes(program) ? program : '__custom__'}
                    onValueChange={(val) => {
                      setProgram(val);
                      if (val !== '__custom__') setCustomProgram('');
                    }}
                  >
                    <Select.Trigger style={{ width: '100%' }} />
                    <Select.Content>
                      {PROGRAMS.map((p) => (
                        <Select.Item key={p} value={p}>{p}</Select.Item>
                      ))}
                      <Select.Item value="__custom__">Custom...</Select.Item>
                    </Select.Content>
                  </Select.Root>
                </Box>
                {program === '__custom__' && (
                  <TextField.Root
                    style={{ flex: 1, fontFamily: 'var(--code-font-family)' }}
                    value={customProgram}
                    onChange={(e) => setCustomProgram(e.target.value)}
                    placeholder="Enter program name"
                    autoFocus
                  />
                )}
              </Flex>
            </Box>

            <Box>
              <Flex align="center" justify="between" mb="1">
                <Text as="label" size="2" weight="medium">Proxy</Text>
                <Text size="1" color="gray">optional</Text>
              </Flex>
              <TextField.Root
                value={proxy}
                onChange={(e) => setProxy(e.target.value)}
                placeholder="e.g. http://127.0.0.1:7890"
              />
            </Box>

            {isClaudeProgram && (
              <Card>
                <Flex direction="column" gap="3">
                  <Text as="label" size="2">
                    <Flex gap="3" align="start">
                      <Checkbox
                        checked={useWorktree}
                        onCheckedChange={(v) => {
                          setUseWorktree(Boolean(v));
                          setWorktreeError('');
                        }}
                      />
                      <Box>
                        <Text weight="medium" as="div">Use git worktree</Text>
                        <Text size="1" color="gray" as="div">
                          Each session gets its own branch
                        </Text>
                      </Box>
                    </Flex>
                  </Text>
                  {useWorktree && (
                    <TextField.Root
                      style={{ fontFamily: 'var(--code-font-family)' }}
                      value={worktreeName}
                      onChange={(e) => {
                        setWorktreeName(e.target.value);
                        setWorktreeError('');
                      }}
                      placeholder="Worktree name (optional, e.g. fix-login)"
                    />
                  )}
                  {worktreeError && (
                    <Callout.Root color="red" size="1">
                      <Callout.Text>{worktreeError}</Callout.Text>
                    </Callout.Root>
                  )}
                </Flex>
              </Card>
            )}

            <Box>
              <Text as="label" size="2" weight="medium" mb="1" style={{ display: 'block' }}>
                Working Directory
              </Text>
              <Flex gap="2">
                <Box style={{ flex: 1, position: 'relative' }}>
                  <TextField.Root
                    ref={cwdInputRef}
                    style={{ fontFamily: 'var(--code-font-family)' }}
                    value={cwd}
                    onChange={(e) => handleCwdChange(e.target.value)}
                    onKeyDown={handleCwdKeyDown}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                    placeholder="Type to autocomplete, Tab to browse"
                  />
                  {showSuggestions && suggestions.length > 0 && (
                    <Box
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        zIndex: 10,
                        marginTop: 4,
                        background: 'var(--color-panel-solid)',
                        border: '1px solid var(--gray-a6)',
                        borderRadius: 'var(--radius-3)',
                        boxShadow: 'var(--shadow-4)',
                        maxHeight: 200,
                        overflowY: 'auto',
                      }}
                    >
                      {suggestions.map((s, i) => (
                        <Box
                          key={s.name}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applySuggestion(s.name);
                          }}
                          style={{
                            padding: '6px 12px',
                            fontFamily: 'var(--code-font-family)',
                            fontSize: 'var(--font-size-2)',
                            cursor: 'pointer',
                            background: i === selectedSuggestion ? 'var(--accent-a3)' : 'transparent',
                            color: 'var(--gray-12)',
                          }}
                        >
                          📁 {s.name}
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>
                <Button
                  type="button"
                  variant="soft"
                  color="gray"
                  onClick={() => browse(cwd || '~')}
                >
                  Browse
                </Button>
              </Flex>
            </Box>

            {showBrowser && (
              <Box>
                {cwdSegments.length > 0 && (
                  <Flex wrap="wrap" align="center" gap="1" mb="2">
                    <Button size="1" variant="soft" color="gray" onClick={() => browse('/')}>/</Button>
                    {cwdSegments.map((seg, i) => (
                      <Button
                        key={i}
                        size="1"
                        variant={i === cwdSegments.length - 1 ? 'soft' : 'ghost'}
                        color="gray"
                        onClick={() => browse('/' + cwdSegments.slice(0, i + 1).join('/'))}
                      >
                        {seg}
                      </Button>
                    ))}
                  </Flex>
                )}
                <Box
                  style={{
                    background: 'var(--color-panel-solid)',
                    border: '1px solid var(--gray-a6)',
                    borderRadius: 'var(--radius-3)',
                    maxHeight: 180,
                    overflowY: 'auto',
                  }}
                >
                  <DirRow
                    icon="↩"
                    label=".."
                    onClick={() => {
                      const parent = cwd.replace(/\/[^/]+\/?$/, '') || '/';
                      browse(parent);
                    }}
                  />
                  {entries.filter((e) => e.is_dir).map((entry) => (
                    <DirRow
                      key={entry.name}
                      icon="📁"
                      label={entry.name}
                      onClick={() => {
                        const next = cwd.endsWith('/')
                          ? `${cwd}${entry.name}`
                          : `${cwd}/${entry.name}`;
                        browse(next);
                      }}
                    />
                  ))}
                </Box>
              </Box>
            )}
          </Flex>

          <Flex gap="3" mt="5" justify="end" align="center">
            <Text size="1" color="gray" style={{ marginRight: 'auto' }}>
              ⌘ + Enter to create
            </Text>
            <Dialog.Close>
              <Button variant="soft" color="gray" onClick={onClose}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button onClick={handleSubmit}>Create</Button>
          </Flex>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function DirRow({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <Box
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        fontFamily: 'var(--code-font-family)',
        fontSize: 'var(--font-size-2)',
        color: 'var(--gray-12)',
        cursor: 'pointer',
        borderBottom: '1px solid var(--gray-a3)',
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </Box>
  );
}
