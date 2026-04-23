import clsx from 'clsx';
import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/**
 * Form input. Primer-aligned: 36px tall, 14px text, 12px horizontal padding,
 * blue focus ring. Touch devices get 44px height.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = 'text', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={clsx(
        'flex h-9 w-full rounded-md border border-border bg-bg-primary px-3 text-sm font-sans',
        'text-text-primary placeholder:text-text-faint',
        'outline-none transition-colors',
        'focus:border-blue focus:shadow-[0_0_0_3px_rgba(56,139,253,0.15)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'touch:h-11 touch:text-base',
        className,
      )}
      {...props}
    />
  );
});
