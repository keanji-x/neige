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
 * Bottom-sliding sheet for mobile.
 *
 * Radix Dialog portals its children to document.body — outside any root
 * <Theme>. We restore the Radix Themes token scope by putting the
 * `.radix-themes` class + `.dark` appearance class + the data attributes
 * Theme would set directly on the portaled Content div. CSS vars cascade
 * to all descendants from there. `data-has-background="false"` so Radix
 * doesn't paint its own bg over our `bg-bg-elevated`.
 *
 * iOS gotchas handled:
 * - `100dvh` (not `vh`) so the sheet accounts for the URL bar
 * - `safe-area-inset-bottom` padding so content clears the home indicator
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
          // Radix Themes token scope — `.dark` activates dark-mode vars.
          'radix-themes dark',
          // Positioning and chrome.
          'fixed left-0 right-0 bottom-0 z-51 w-full',
          'bg-bg-elevated border-t border-border rounded-t-lg shadow-lg',
          'text-text-primary',
          'focus:outline-none',
          // Height: dynamic viewport units so iOS URL bar doesn't overflow.
          'max-h-[90dvh] overflow-y-auto',
          // Padding: generous on sides/top, safe-area respecting at bottom.
          'p-6 pb-[calc(env(safe-area-inset-bottom)+24px)]',
          // Enter/exit animations.
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
