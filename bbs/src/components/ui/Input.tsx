import { forwardRef, type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, id, className = "", ...props },
  ref
) {
  const inputId = id ?? props.name;
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-sm text-muted mb-1">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={[
          "w-full h-11 px-3 rounded bg-surface-raised border border-border text-text",
          "focus:outline-none focus:ring-2 focus:ring-gold",
          error ? "border-danger-bright" : "",
          className
        ].join(" ")}
        {...props}
      />
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger-bright">
          {error}
        </p>
      )}
    </div>
  );
});
