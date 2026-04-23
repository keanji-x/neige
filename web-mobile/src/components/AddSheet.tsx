import { useEffect, useState } from 'react'
import { Sheet, SheetContent } from '@neige/shared'
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Checkbox,
  Flex,
  Tabs,
  Text,
  TextField,
} from '@radix-ui/themes'
import type { ConvInfo, CreateConvRequest } from '../types'
import { getConfig, saveConfig } from '../api'
import { DirPicker } from './DirPicker'

interface Props {
  conversations: ConvInfo[]
  inStack: string[]
  onPickExisting: (id: string) => void
  onPickMany: (ids: string[]) => void
  onCreate: (req: CreateConvRequest) => Promise<void>
  onClose: () => void
}

type Mode = 'existing' | 'new'

function shortCwd(cwd: string): string {
  const home = '/home/'
  if (cwd.startsWith(home)) {
    const rest = cwd.slice(home.length)
    const slash = rest.indexOf('/')
    return slash === -1 ? `~${rest}` : `~${rest.slice(slash)}`
  }
  return cwd
}

export function AddSheet({
  conversations,
  inStack,
  onPickExisting,
  onPickMany,
  onCreate,
  onClose,
}: Props) {
  const taken = new Set(inStack)
  const available = conversations.filter((c) => !taken.has(c.id))
  const [mode, setMode] = useState<Mode>(available.length > 0 ? 'existing' : 'new')

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent>
        <Tabs.Root value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <Flex justify="between" align="center" gap="3" mb="3">
            <Tabs.List>
              <Tabs.Trigger value="existing">加入已有</Tabs.Trigger>
              <Tabs.Trigger value="new">新建</Tabs.Trigger>
            </Tabs.List>
            <Button variant="ghost" color="gray" onClick={onClose}>
              取消
            </Button>
          </Flex>

          <Tabs.Content value="existing">
            <ExistingList
              conversations={conversations}
              available={available}
              onPick={onPickExisting}
              onPickAll={() => onPickMany(available.map((c) => c.id))}
            />
          </Tabs.Content>
          <Tabs.Content value="new">
            <NewSessionForm conversations={conversations} onCreate={onCreate} />
          </Tabs.Content>
        </Tabs.Root>
      </SheetContent>
    </Sheet>
  )
}

function ExistingList({
  conversations,
  available,
  onPick,
  onPickAll,
}: {
  conversations: ConvInfo[]
  available: ConvInfo[]
  onPick: (id: string) => void
  onPickAll: () => void
}) {
  if (conversations.length === 0) {
    return (
      <Box py="6" style={{ textAlign: 'center' }}>
        <Text as="div" size="2" color="gray">server 上没有会话</Text>
        <Text as="div" size="1" color="gray" mt="1">切到"新建"tab 建一个</Text>
      </Box>
    )
  }
  if (available.length === 0) {
    return (
      <Box py="6" style={{ textAlign: 'center' }}>
        <Text size="2" color="gray">所有会话都已加入 stack</Text>
      </Box>
    )
  }
  return (
    <Flex direction="column" gap="2">
      {available.length > 1 && (
        <Button size="3" variant="soft" onClick={onPickAll}>
          加入全部（{available.length}）
        </Button>
      )}
      {available.map((c) => (
        <SessionRow key={c.id} conv={c} onPick={() => onPick(c.id)} />
      ))}
    </Flex>
  )
}

function SessionRow({ conv, onPick }: { conv: ConvInfo; onPick: () => void }) {
  const color =
    conv.status === 'running' ? 'var(--green-9)' :
    conv.status === 'detached' ? 'var(--yellow-9)' : 'var(--gray-8)'
  return (
    <Card onClick={onPick} style={{ cursor: 'pointer' }}>
      <Flex align="center" gap="3">
        <span
          style={{
            display: 'inline-block',
            width: 8, height: 8, borderRadius: '50%',
            background: color, flex: '0 0 auto',
          }}
        />
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text as="div" size="2" weight="medium" truncate>{conv.title}</Text>
          <Text
            as="div"
            size="1"
            color="gray"
            truncate
            style={{ fontFamily: 'var(--code-font-family)' }}
          >
            {shortCwd(conv.effective_cwd)}
          </Text>
        </Box>
      </Flex>
    </Card>
  )
}

function NewSessionForm({
  conversations,
  onCreate,
}: {
  conversations: ConvInfo[]
  onCreate: (req: CreateConvRequest) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [cwd, setCwd] = useState('')
  const [useWorktree, setUseWorktree] = useState(true)
  const [worktreeName, setWorktreeName] = useState('')
  const [proxy, setProxy] = useState('')
  const [savedProxy, setSavedProxy] = useState('')
  const [pending, setPending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)

  useEffect(() => {
    let cancelled = false
    getConfig().then((cfg) => {
      if (cancelled) return
      const p = cfg.proxy ?? ''
      setProxy(p)
      setSavedProxy(p)
    })
    return () => { cancelled = true }
  }, [])

  const cwdSuggestions = Array.from(
    new Set(conversations.map((c) => c.cwd)),
  ).slice(0, 6)

  const canSubmit = title.trim() !== '' && cwd.trim() !== '' && !pending

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setPending(true)
    setErr(null)
    try {
      const proxyVal = proxy.trim()
      if (proxyVal !== savedProxy) {
        await saveConfig({ proxy: proxyVal || undefined })
        setSavedProxy(proxyVal)
      }
      await onCreate({
        title: title.trim(),
        program: 'claude',
        cwd: cwd.trim(),
        use_worktree: useWorktree,
        worktree_name: worktreeName.trim() || undefined,
        proxy: proxyVal || undefined,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <Flex direction="column" gap="3">
        <Box>
          <Text as="label" size="2" weight="medium" mb="1" style={{ display: 'block' }}>
            名称
          </Text>
          <TextField.Root
            size="3"
            value={title}
            placeholder="e.g. fix-login-bug"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Box>

        <Box>
          <Text as="label" size="2" weight="medium" mb="1" style={{ display: 'block' }}>
            工作目录
          </Text>
          <Flex gap="2">
            <TextField.Root
              size="3"
              style={{ flex: 1, fontFamily: 'var(--code-font-family)' }}
              value={cwd}
              placeholder="/home/kenji/..."
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setCwd(e.target.value)}
            />
            <Button
              type="button"
              size="3"
              variant="soft"
              color="gray"
              onClick={() => setBrowsing(true)}
              aria-label="browse directories"
            >
              📁
            </Button>
          </Flex>
        </Box>

        {browsing && (
          <DirPicker
            initial={cwd}
            onPick={(p) => {
              setCwd(p)
              setBrowsing(false)
            }}
            onClose={() => setBrowsing(false)}
          />
        )}

        {cwdSuggestions.length > 0 && (
          <Flex wrap="wrap" gap="1">
            {cwdSuggestions.map((s) => (
              <Badge
                key={s}
                size="2"
                variant="soft"
                color="gray"
                onClick={() => setCwd(s)}
                style={{ cursor: 'pointer', fontFamily: 'var(--code-font-family)' }}
              >
                {shortCwd(s)}
              </Badge>
            ))}
          </Flex>
        )}

        <Card>
          <Text as="label" size="2">
            <Flex gap="3" align="start">
              <Checkbox
                checked={useWorktree}
                onCheckedChange={(v) => setUseWorktree(Boolean(v))}
              />
              <Box>
                <Text weight="medium" as="div">使用 worktree</Text>
                <Text size="1" color="gray" as="div">每个 session 独立的 git 分支</Text>
              </Box>
            </Flex>
          </Text>
        </Card>

        {useWorktree && (
          <Box>
            <Text as="label" size="2" weight="medium" mb="1" style={{ display: 'block' }}>
              worktree 名（可选）
            </Text>
            <TextField.Root
              size="3"
              style={{ fontFamily: 'var(--code-font-family)' }}
              value={worktreeName}
              placeholder="auto"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setWorktreeName(e.target.value)}
            />
          </Box>
        )}

        <Box>
          <Text as="label" size="2" weight="medium" mb="1" style={{ display: 'block' }}>
            HTTP 代理（可选）
          </Text>
          <TextField.Root
            size="3"
            type="url"
            style={{ fontFamily: 'var(--code-font-family)' }}
            value={proxy}
            placeholder="http://127.0.0.1:10809"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setProxy(e.target.value)}
          />
        </Box>

        {err && (
          <Callout.Root color="red" size="1">
            <Callout.Text>{err}</Callout.Text>
          </Callout.Root>
        )}

        <Button type="submit" size="3" disabled={!canSubmit}>
          {pending ? '创建中…' : '创建 session'}
        </Button>
      </Flex>
    </form>
  )
}
