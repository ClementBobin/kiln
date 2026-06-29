import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

/**
 * Example primitive UI component — replace with your own design-system
 * button. Demonstrates the components/ui/ convention: small, unstyled-ish,
 * reusable building blocks (as opposed to feature-specific components).
 */
export function Button({ children, ...props }: ButtonProps) {
  return (
    <button {...props} className={`btn ${props.className ?? ""}`.trim()}>
      {children}
    </button>
  );
}
