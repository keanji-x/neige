import * as DialogPrimitive from '@radix-ui/react-dialog';
import clsx from 'clsx';
import type { ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </DialogPrimitive.Root>
  );
}

interface DialogContentProps {
  className?: string;
  children: ReactNode;
}

export function DialogContent({ className, children }: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={clsx(
          'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm',
          'data-[state=open]:animate-[neige-fade-in_150ms_ease-out]',
          'data-[state=closed]:animate-[neige-fade-out_120ms_ease-in]',
        )}
      />
      <DialogPrimitive.Content
        className={clsx(
          'fixed left-1/2 top-1/2 z-51 w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
          'bg-bg-secondary border border-border rounded-lg shadow-lg p-6',
          'text-text-primary',
          'focus:outline-none',
          'data-[state=open]:animate-[neige-scale-in_160ms_ease-out]',
          'data-[state=closed]:animate-[neige-scale-out_120ms_ease-in]',
          className,
        )}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({ children }: { children: ReactNode }) {
  return (
    <DialogPrimitive.Title className="text-lg font-semibold text-text-primary mb-1">
      {children}
    </DialogPrimitive.Title>
  );
}

export function DialogDescription({ children }: { children: ReactNode }) {
  return (
    <DialogPrimitive.Description className="text-sm text-text-muted mb-4">
      {children}
    </DialogPrimitive.Description>
  );
}

export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
