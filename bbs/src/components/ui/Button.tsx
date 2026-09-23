import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-gold text-bg hover:bg-gold-hover focus-visible:ring-2 focus-visible:ring-gold",
  secondary:
    "bg-surface-raised text-text border border-border hover:bg-surface focus-visible:ring-2 focus-visible:ring-gold",
  ghost:
    "bg-transparent text-text hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-gold",
  danger:
    "bg-danger text-text hover:bg-danger-bright focus-visible:ring-2 focus-visible:ring-danger"
};

const sizeClasses: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-6 text-base"
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className = "", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={[
        "inline-flex items-center justify-center rounded font-medium transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "focus:outline-none",
        variantClasses[variant],
        sizeClasses[size],
        className
      ].join(" ")}
      {...props}
    />
  );
});
