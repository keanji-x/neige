import { Button, Dialog, DialogContent } from '@neige/shared';

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
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <div
          className="w-[380px] max-w-full"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onConfirm();
          }}
        >
          <h2 className="m-0 mb-5 text-lg font-semibold tracking-[-0.01em]">{title}</h2>
          <p className="text-base text-text-secondary m-0 mb-5 leading-[1.5]">{message}</p>
          <div className="flex gap-2 items-center justify-end mt-3">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirm} autoFocus>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
