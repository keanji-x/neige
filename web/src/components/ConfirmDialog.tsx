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
          className="confirm-modal"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onConfirm();
          }}
        >
          <h2>{title}</h2>
          <p className="confirm-message">{message}</p>
          <div className="modal-actions">
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
