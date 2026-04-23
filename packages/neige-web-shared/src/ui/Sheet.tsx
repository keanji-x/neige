import * as DialogPrimitive from '@radix-ui/react-dialog';
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

/**
 * Radix Dialog portals its children outside the root <Theme>, which would
 * drop the token scope Radix Themes needs. Instead of nesting a <Theme>
 * component (which wraps in an extra div and can interfere with TextField
 * layout), we apply the `.radix-themes` class + data attributes directly
 * on the Portal's Content. CSS vars cascade to all descendants normally.
 *
 * The data-* attributes must stay in sync with whatever <Theme> is used at
 * the app root — mobile uses appearance=dark, accentColor=green,
 * grayColor=slate, radius=medium, scaling=100%.
 */
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
          'radix-themes',
          'fixed left-0 right-0 bottom-0 z-51 w-full',
          'bg-bg-elevated border-t border-border rounded-t-lg shadow-lg p-6',
          'text-text-primary',
          'max-h-[90vh] overflow-y-auto',
          'focus:outline-none',
          'data-[state=open]:animate-[neige-slide-up_200ms_ease-out]',
          'data-[state=closed]:animate-[neige-slide-down_160ms_ease-in]',
          className,
        )}
        data-is-root-theme="false"
        data-accent-color="green"
        data-gray-color="slate"
        data-has-background="false"
        data-panel-background="solid"
        data-radius="medium"
        data-scaling="100"
        {...props}
      >
        {children}
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
