import { forwardRef, type SelectHTMLAttributes } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, id, className = "", children, ...props },
  ref
) {
  const selectId = id ?? props.name;
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={selectId} className="block text-sm text-muted mb-1">
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        aria-invalid={error ? true : undefined}
        className={[
          "w-full h-11 px-3 rounded bg-surface-raised border border-border text-text",
          "focus:outline-none focus:ring-2 focus:ring-gold",
          error ? "border-danger-bright" : "",
          className
        ].join(" ")}
        {...props}
      >
        {children}
      </select>
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger-bright">
          {error}
        </p>
      )}
    </div>
  );
});
