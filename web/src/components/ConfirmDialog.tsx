import { Button, Dialog, Flex } from '@radix-ui/themes';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <Dialog.Content maxWidth="420px">
        <div
          onKeyDown={(e) => {
            if (e.key === 'Enter') onConfirm();
          }}
        >
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description size="2" color="gray" mb="4">
            {message}
          </Dialog.Description>

          <Flex gap="3" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray" onClick={onCancel}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button color="red" onClick={onConfirm} autoFocus>
              {confirmLabel}
            </Button>
          </Flex>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
