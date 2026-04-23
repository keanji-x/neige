import * as ToastPrimitive from '@radix-ui/react-toast';
import clsx from 'clsx';
import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, ElementRef } from 'react';

export type ToastVariant = 'default' | 'error' | 'success';

const variantClasses: Record<ToastVariant, string> = {
  default: 'border-border',
  error: 'border-red',
  success: 'border-green-bright',
};

interface ToastRootProps
  extends ComponentPropsWithoutRef<typeof ToastPrimitive.Root> {
  variant?: ToastVariant;
}

export const Toast = forwardRef<
  ElementRef<typeof ToastPrimitive.Root>,
  ToastRootProps
>(function Toast({ className, variant = 'default', ...props }, ref) {
  return (
    <ToastPrimitive.Root
      ref={ref}
      className={clsx(
        'bg-bg-secondary border rounded-md shadow-md p-4',
        'text-sm text-text-primary',
        'flex gap-3 items-start',
        'data-[state=open]:animate-[neige-slide-up_180ms_ease-out]',
        'data-[state=closed]:animate-[neige-fade-out_120ms_ease-in]',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
});

export const ToastTitle = forwardRef<
  ElementRef<typeof ToastPrimitive.Title>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(function ToastTitle({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Title
      ref={ref}
      className={clsx('font-medium text-text-primary', className)}
      {...props}
    />
  );
});

export const ToastDescription = forwardRef<
  ElementRef<typeof ToastPrimitive.Description>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(function ToastDescription({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Description
      ref={ref}
      className={clsx('text-sm text-text-muted mt-1', className)}
      {...props}
    />
  );
});

export const ToastViewport = forwardRef<
  ElementRef<typeof ToastPrimitive.Viewport>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(function ToastViewport({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Viewport
      ref={ref}
      className={clsx(
        'fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-96 max-w-[calc(100vw-2rem)]',
        'outline-none',
        className,
      )}
      {...props}
    />
  );
});

export const ToastClose = ToastPrimitive.Close;
export const ToastAction = ToastPrimitive.Action;
