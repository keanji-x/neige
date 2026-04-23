import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Theme } from '@radix-ui/themes';
import clsx from 'clsx';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function Sheet({ open, onOpenChange, children }: SheetProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </DialogPrimitive.Root>
  );
}

type SheetContentProps = ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
>;

export function SheetContent({
  className,
  children,
  ...props
}: SheetContentProps) {
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
          'fixed left-0 right-0 bottom-0 z-51 w-full',
          'bg-bg-elevated border-t border-border rounded-t-lg shadow-lg p-6',
          'text-text-primary',
          'max-h-[90vh] overflow-y-auto',
          'focus:outline-none',
          'data-[state=open]:animate-[neige-slide-up_200ms_ease-out]',
          'data-[state=closed]:animate-[neige-slide-down_160ms_ease-in]',
          className,
        )}
        {...props}
      >
        {/* Radix Dialog portals outside the root <Theme>, which would drop
            token scope. Re-apply Theme here so <TextField>/<Button>/etc.
            inside the sheet still see the tokens. hasBackground=false so we
            don't double up the sheet's own bg. */}
        <Theme
          appearance="dark"
          accentColor="green"
          grayColor="slate"
          radius="medium"
          hasBackground={false}
        >
          {children}
        </Theme>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetTitle({ children }: { children: ReactNode }) {
  return (
    <DialogPrimitive.Title className="text-lg font-semibold text-text-primary mb-1">
      {children}
    </DialogPrimitive.Title>
  );
}

export function SheetDescription({ children }: { children: ReactNode }) {
  return (
    <DialogPrimitive.Description className="text-sm text-text-muted mb-4">
      {children}
    </DialogPrimitive.Description>
  );
}

export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
