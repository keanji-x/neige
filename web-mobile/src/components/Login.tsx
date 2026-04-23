import { useState } from 'react'
import { Box, Button, Callout, Card, Flex, Heading, Text, TextField } from '@radix-ui/themes'
import { login } from '../api'

interface Props {
  onAuthed: () => void
}

export function Login({ onAuthed }: Props) {
  const [token, setToken] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    setPending(true)
    setErr(null)
    const ok = await login(token)
    setPending(false)
    if (ok) onAuthed()
    else setErr('密码错误或登录受限')
  }

  return (
    <Flex align="center" justify="center" style={{ height: '100%', padding: 24 }}>
      <Box style={{ width: '100%', maxWidth: 360 }}>
        <Card size="4">
          <form onSubmit={submit}>
            <Flex direction="column" gap="4">
              <Box>
                <Heading size="5" weight="medium">neige</Heading>
                <Text size="1" color="gray" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  mobile · sign in
                </Text>
              </Box>
              <TextField.Root
                size="3"
                type="password"
                inputMode="text"
                autoComplete="current-password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              {err && (
                <Callout.Root color="red" size="1">
                  <Callout.Text>{err}</Callout.Text>
                </Callout.Root>
              )}
              <Button type="submit" size="3" disabled={pending || !token}>
                {pending ? '...' : 'Sign in'}
              </Button>
            </Flex>
          </form>
        </Card>
      </Box>
    </Flex>
  )
}
