import * as ToastPrimitive from '@radix-ui/react-toast';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Toast,
  ToastDescription,
  ToastTitle,
  ToastViewport,
  type ToastVariant,
} from './Toast';

interface ToastOptions {
  title?: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

interface ToastProviderProps {
  children: ReactNode;
  /** Default auto-dismiss duration (ms). Individual toasts may override. */
  duration?: number;
  /** Swipe-to-dismiss direction. */
  swipeDirection?: 'right' | 'left' | 'up' | 'down';
}

export function ToastProvider({
  children,
  duration = 4000,
  swipeDirection = 'right',
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((opts: ToastOptions) => {
    setToasts((prev) => [...prev, { ...opts, id: Date.now() + Math.random() }]);
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider duration={duration} swipeDirection={swipeDirection}>
        {children}
        {toasts.map((t) => (
          <Toast
            key={t.id}
            variant={t.variant ?? 'default'}
            duration={t.duration}
            onOpenChange={(open) => {
              if (!open) remove(t.id);
            }}
          >
            <div className="flex-1">
              {t.title && <ToastTitle>{t.title}</ToastTitle>}
              {t.description && <ToastDescription>{t.description}</ToastDescription>}
            </div>
          </Toast>
        ))}
        <ToastViewport />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return ctx;
}
