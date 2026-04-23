import clsx from 'clsx';
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant =
  | 'default'
  | 'primary'
  | 'ghost'
  | 'outline'
  | 'destructive';

export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const base =
  'inline-flex items-center justify-center gap-2 font-medium rounded-md ' +
  'transition-colors duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary ' +
  'disabled:pointer-events-none disabled:opacity-50 ' +
  'whitespace-nowrap';

const variantClasses: Record<ButtonVariant, string> = {
  default:
    'bg-bg-tertiary text-text-primary border border-border hover:bg-bg-hover',
  primary:
    'bg-action text-white border border-transparent hover:bg-action-hover',
  ghost:
    'bg-transparent text-text-primary hover:bg-bg-hover border border-transparent',
  outline:
    'bg-transparent text-text-primary border border-border hover:bg-bg-hover',
  destructive:
    'bg-red text-white border border-transparent hover:brightness-110',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs touch:h-9 touch:px-3',
  md: 'h-8 px-3 text-sm touch:h-11 touch:px-4 touch:text-base',
  lg: 'h-10 px-4 text-base touch:h-12 touch:px-5',
  icon: 'h-8 w-8 p-0 touch:h-11 touch:w-11',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'default', size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(base, variantClasses[variant], sizeClasses[size], className)}
      {...props}
    />
  );
});
