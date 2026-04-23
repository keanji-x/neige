import { useEffect, useState } from 'react'
import { Sheet, SheetContent } from '@neige/shared'
import { Badge, Box, Button, Callout, Flex, Text } from '@radix-ui/themes'
import { browseDir } from '../api'
import type { BrowseResponse } from '../types'

interface Props {
  initial: string
  onPick: (path: string) => void
  onClose: () => void
}

export function DirPicker({ initial, onPick, onClose }: Props) {
  const [data, setData] = useState<BrowseResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const browse = (p: string) => {
    setLoading(true)
    setErr(null)
    browseDir(p)
      .then((r) => setData(r))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    browse(initial && initial.trim() !== '' ? initial : '~')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goInto = (name: string) => {
    if (!data) return
    const base = data.path.replace(/\/+$/, '')
    browse(`${base}/${name}`)
  }
  const goUp = () => {
    if (!data) return
    if (data.path === '/' || data.path === '') return
    const parent = data.path.replace(/\/[^/]+\/?$/, '') || '/'
    browse(parent)
  }

  const currentPath = data?.path ?? initial

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent style={{ maxHeight: '100vh', height: '100vh' }}>
        <Flex direction="column" gap="3" style={{ height: '100%' }}>
          <Flex justify="between" align="start" gap="3">
            <Box style={{ minWidth: 0, flex: 1 }}>
              <Text as="div" size="3" weight="medium">选择目录</Text>
              <Flex align="center" gap="2" mt="1">
                <Text
                  size="1"
                  color="gray"
                  truncate
                  style={{ fontFamily: 'var(--code-font-family)' }}
                >
                  {currentPath}
                </Text>
                {data?.is_git_repo && (
                  <Badge size="1" color="green" variant="soft">git</Badge>
                )}
              </Flex>
            </Box>
            <Button variant="ghost" color="gray" onClick={onClose}>
              取消
            </Button>
          </Flex>

          <Flex gap="2">
            <Button
              size="2"
              variant="soft"
              color="gray"
              onClick={goUp}
              disabled={!data || data.path === '/'}
            >
              ‹ 上级
            </Button>
            <Button
              size="2"
              onClick={() => data && onPick(data.path)}
              disabled={!data}
              style={{ flex: 1 }}
            >
              使用此目录
            </Button>
          </Flex>

          <Box
            style={{
              flex: 1,
              overflowY: 'auto',
              border: '1px solid var(--gray-a5)',
              borderRadius: 'var(--radius-3)',
              background: 'var(--color-panel-solid)',
            }}
          >
            {loading && (
              <Box py="4" style={{ textAlign: 'center' }}>
                <Text size="2" color="gray">loading…</Text>
              </Box>
            )}
            {err && (
              <Box p="3">
                <Callout.Root color="red" size="1">
                  <Callout.Text>{err}</Callout.Text>
                </Callout.Root>
              </Box>
            )}
            {!loading && !err && data?.entries.length === 0 && (
              <Box py="4" style={{ textAlign: 'center' }}>
                <Text size="2" color="gray">（空目录）</Text>
              </Box>
            )}
            {!loading && !err && data?.entries.map((e) => (
              <DirRow
                key={e.name}
                icon={e.is_dir ? '📁' : '📄'}
                label={e.name}
                chevron={e.is_dir}
                disabled={!e.is_dir}
                onClick={() => e.is_dir && goInto(e.name)}
              />
            ))}
          </Box>
        </Flex>
      </SheetContent>
    </Sheet>
  )
}

function DirRow({
  icon,
  label,
  chevron,
  disabled,
  onClick,
}: {
  icon: string
  label: string
  chevron: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Flex
      align="center"
      gap="3"
      px="3"
      py="3"
      onClick={disabled ? undefined : onClick}
      style={{
        cursor: disabled ? 'default' : 'pointer',
        borderBottom: '1px solid var(--gray-a3)',
        opacity: disabled ? 0.4 : 1,
        fontFamily: 'var(--code-font-family)',
      }}
    >
      <Text size="3">{icon}</Text>
      <Text size="2" style={{ flex: 1, minWidth: 0 }} truncate>
        {label}
      </Text>
      {chevron && <Text size="3" color="gray">›</Text>}
    </Flex>
  )
}
