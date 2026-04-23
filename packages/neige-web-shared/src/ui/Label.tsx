import clsx from 'clsx';
import { forwardRef } from 'react';
import type { LabelHTMLAttributes } from 'react';

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

/**
 * Form label. Primer-aligned: 14px, semibold, same size as input content
 * so the label→input visual rhythm stays tight.
 */
export const Label = forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { className, ...props },
  ref,
) {
  return (
    <label
      ref={ref}
      className={clsx(
        'block text-sm font-medium text-text-primary',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
});
