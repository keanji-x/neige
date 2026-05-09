// Privacy-warning + create-share dialog. Two states:
//   1. "warn"     — show what's about to be shared, ask for confirmation.
//   2. "shared"   — show the resulting URL with copy-to-clipboard.
// On error we toast and stay on the warning step so the user can retry.

import { useState } from 'react';
import { Button, Dialog, Flex, Text, TextField } from '@radix-ui/themes';
import { useToast } from '@neige/shared';

interface ShareDialogProps {
  sessionId: string;
  open: boolean;
  onClose: () => void;
}

interface CreateShareResponse {
  token: string;
  url: string;
}

export function ShareDialog({ sessionId, open, onClose }: ShareDialogProps) {
  const [step, setStep] = useState<'warn' | 'shared'>('warn');
  const [pending, setPending] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const { toast } = useToast();

  const reset = () => {
    setStep('warn');
    setShareUrl(null);
    setPending(false);
  };

  const handleClose = () => {
    onClose();
    // Wait one frame so the close animation reads the current step before
    // we reset; not strictly necessary but avoids a flicker.
    setTimeout(reset, 200);
  };

  const handleConfirm = async () => {
    setPending(true);
    try {
      const res = await fetch(`/api/conversations/${sessionId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.text();
          if (body) msg = body;
        } catch {
          /* keep default */
        }
        throw new Error(msg);
      }
      const data = (await res.json()) as CreateShareResponse;
      const fullUrl = new URL(data.url, window.location.origin).toString();
      setShareUrl(fullUrl);
      setStep('shared');
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Failed to create share link',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPending(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({ variant: 'success', title: 'Link copied' });
    } catch {
      toast({ variant: 'error', title: 'Copy failed — select the URL manually' });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <Dialog.Content maxWidth="520px">
        {step === 'warn' && (
          <>
            <Dialog.Title>Share this conversation</Dialog.Title>
            <Dialog.Description size="2" color="gray" mb="3">
              Anyone with the link can view every message, tool input, and tool
              output in this session — including command stdout, file paths,
              and file contents.
            </Dialog.Description>
            <Text as="p" size="2" color="amber" mb="4">
              Do not share if this conversation may contain secrets, credentials,
              or sensitive code.
            </Text>
            <Flex gap="3" justify="end">
              <Dialog.Close>
                <Button variant="soft" color="gray" disabled={pending}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button onClick={handleConfirm} loading={pending}>
                Create share link
              </Button>
            </Flex>
          </>
        )}
        {step === 'shared' && shareUrl && (
          <>
            <Dialog.Title>Share link ready</Dialog.Title>
            <Dialog.Description size="2" color="gray" mb="3">
              Send this URL to your colleague. They can open it in any browser
              without signing in.
            </Dialog.Description>
            <TextField.Root value={shareUrl} readOnly mb="3" />
            <Flex gap="3" justify="end">
              <Button
                variant="soft"
                onClick={() => window.open(shareUrl, '_blank', 'noopener')}
              >
                Open in new tab
              </Button>
              <Button onClick={handleCopy}>Copy link</Button>
              <Dialog.Close>
                <Button variant="soft" color="gray">
                  Done
                </Button>
              </Dialog.Close>
            </Flex>
          </>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
