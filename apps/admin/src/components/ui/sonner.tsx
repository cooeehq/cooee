import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      {...props}
      className="toaster group"
      position="top-center"
      theme="dark"
      style={
        {
          "--normal-bg": "oklch(18% 0.006 56)",
          "--normal-text": "oklch(98% 0.001 106)",
          "--normal-border": "oklch(30% 0.008 56)",
          "--border-radius": "var(--radius)",
          ...props.style,
        } as CSSProperties
      }
    />
  );
}

export { Toaster };
