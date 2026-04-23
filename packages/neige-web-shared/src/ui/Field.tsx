import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Label } from './Label';

interface FieldProps {
  /** Primary label text (14px semibold). Pass falsy to omit. */
  label?: ReactNode;
  /** Muted hint rendered inline next to the label. */
  hint?: ReactNode;
  /** Error text rendered below the input in red. Pass a string or node. */
  error?: ReactNode;
  /** Usually a single `<Input>`, but can be a `<div className="flex">…</div>`
      composite (e.g. input + button). The Field owns the label/input/error
      vertical rhythm (6px label→input, 4px input→error). */
  children: ReactNode;
  className?: string;
  /** HTML `for`/`htmlFor` pointer, if you need to wire up assistive tech. */
  htmlFor?: string;
}

/**
 * Label + control + optional hint + optional error, with consistent rhythm.
 *
 * Use inside a `<div className="space-y-5">` container to stack fields with
 * 20 px between them — that `space-y-5` enforces the "field-to-field" rhythm
 * while Field enforces the "within-field" rhythm.
 */
export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: FieldProps) {
  return (
    <div className={clsx('space-y-1.5', className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {hint && (
            <span className="ml-2 text-xs font-normal text-text-muted">
              {hint}
            </span>
          )}
        </Label>
      )}
      {children}
      {error && (
        <p className="text-xs text-red pt-0.5">{error}</p>
      )}
    </div>
  );
}
