import { useEffect, useRef, useState } from 'react';
import { Box, Dialog, Flex, Text, TextField } from '@radix-ui/themes';
import type { RecentCommand } from '../hooks/useConfig';
import type { ConvInfo } from '../types';

interface QuickLauncherProps {
  open: boolean;
  onClose: () => void;
  onLaunch: (cmd: RecentCommand) => void;
  onSelect: (id: string) => void;
  recentCommands: RecentCommand[];
  conversations: ConvInfo[];
}

export function QuickLauncher({
  open,
  onClose,
  onLaunch,
  onSelect,
  recentCommands,
  conversations,
}: QuickLauncherProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
    }
  }, [open]);

  const lq = query.toLowerCase();

  const activeSessions = conversations
    .filter((c) => c.status !== 'dead')
    .filter(
      (c) =>
        !lq ||
        c.title.toLowerCase().includes(lq) ||
        c.cwd.toLowerCase().includes(lq) ||
        c.program.toLowerCase().includes(lq),
    );

  const filteredRecent = recentCommands.filter(
    (cmd) =>
      !lq ||
      cmd.program.toLowerCase().includes(lq) ||
      cmd.cwd.toLowerCase().includes(lq) ||
      (cmd.title && cmd.title.toLowerCase().includes(lq)),
  );

  interface DisplayItem {
    type: 'session' | 'recent';
    session?: ConvInfo;
    command?: RecentCommand;
    label: string;
    detail: string;
  }

  const items: DisplayItem[] = [];

  for (const s of activeSessions) {
    items.push({
      type: 'session',
      session: s,
      label: s.title,
      detail: `${s.program} — ${s.cwd.replace(/^\/home\/[^/]+/, '~')}`,
    });
  }
  for (const cmd of filteredRecent) {
    items.push({
      type: 'recent',
      command: cmd,
      label: cmd.title || cmd.program,
      detail: `${cmd.program} — ${cmd.cwd ? cmd.cwd.replace(/^\/home\/[^/]+/, '~') : 'default'}`,
    });
  }

  const handleSelect = (item: DisplayItem) => {
    if (item.type === 'session' && item.session) {
      onSelect(item.session.id);
    } else if (item.type === 'recent' && item.command) {
      onLaunch(item.command);
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((prev) => Math.min(prev + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && items.length > 0) {
      e.preventDefault();
      handleSelect(items[selected]);
    }
  };

  useEffect(() => {
    const el = document.querySelector('[data-ql-selected="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const hasSessions = items.some((i) => i.type === 'session');
  const hasRecent = items.some((i) => i.type === 'recent');
  let globalIdx = 0;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Content
        maxWidth="560px"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div onKeyDown={handleKeyDown}>
          <Dialog.Title>Quick Launcher</Dialog.Title>
          <Dialog.Description size="1" color="gray" mb="3">
            Switch sessions or launch a recent command.
          </Dialog.Description>

          <TextField.Root
            ref={inputRef}
            size="3"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder="Type to filter…"
          >
            <TextField.Slot>⚡</TextField.Slot>
          </TextField.Root>

          <Box mt="3" style={{ maxHeight: 360, overflowY: 'auto' }}>
            {items.length === 0 && (
              <Box py="5" style={{ textAlign: 'center' }}>
                <Text size="2" color="gray">
                  {query ? 'No matches' : 'No sessions or recent commands'}
                </Text>
              </Box>
            )}

            {hasSessions && <SectionLabel>Active sessions</SectionLabel>}
            {items
              .filter((i) => i.type === 'session')
              .map((item) => {
                const idx = globalIdx++;
                const s = item.session!;
                return (
                  <Row
                    key={`s:${s.id}`}
                    selected={idx === selected}
                    icon={<StatusDot status={s.status} />}
                    title={item.label}
                    detail={item.detail}
                    onClick={() => handleSelect(item)}
                    onHover={() => setSelected(idx)}
                  />
                );
              })}

            {hasRecent && <SectionLabel>Launch new</SectionLabel>}
            {items
              .filter((i) => i.type === 'recent')
              .map((item, i) => {
                const idx = globalIdx++;
                return (
                  <Row
                    key={`r:${i}`}
                    selected={idx === selected}
                    icon="🚀"
                    title={item.label}
                    detail={item.detail}
                    onClick={() => handleSelect(item)}
                    onHover={() => setSelected(idx)}
                  />
                );
              })}
          </Box>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text as="div" size="1" weight="medium" color="gray" mt="2" mb="1" style={{ paddingLeft: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {children}
    </Text>
  );
}

function Row({
  selected,
  icon,
  title,
  detail,
  onClick,
  onHover,
}: {
  selected: boolean;
  icon: React.ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
  onHover: () => void;
}) {
  return (
    <Flex
      data-ql-selected={selected}
      onClick={onClick}
      onMouseEnter={onHover}
      align="center"
      gap="3"
      px="3"
      py="2"
      style={{
        cursor: 'pointer',
        background: selected ? 'var(--accent-a3)' : 'transparent',
        borderRadius: 'var(--radius-3)',
      }}
    >
      <Box style={{ flex: '0 0 auto', width: 16, textAlign: 'center' }}>{icon}</Box>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text as="div" size="2" weight="medium" truncate>
          {title}
        </Text>
        <Text as="div" size="1" color="gray" truncate style={{ fontFamily: 'var(--code-font-family)' }}>
          {detail}
        </Text>
      </Box>
    </Flex>
  );
}

function StatusDot({ status }: { status: ConvInfo['status'] }) {
  const color =
    status === 'running' ? 'var(--green-9)' : status === 'detached' ? 'var(--yellow-9)' : 'var(--gray-8)';
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
      }}
    />
  );
}
