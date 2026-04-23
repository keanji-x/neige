import clsx from 'clsx';
import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = 'text', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={clsx(
        'flex h-8 touch:h-11 w-full rounded-md border border-border bg-bg-tertiary px-3 text-sm',
        'text-text-primary placeholder:text-text-muted',
        'focus:outline-none focus:ring-2 focus:ring-blue focus:border-blue',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
});
