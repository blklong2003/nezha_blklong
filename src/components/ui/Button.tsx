import {
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
} from "react";

export type ButtonVariant =
  | "default"
  | "primary"
  | "outline"
  | "secondary"
  | "ghost"
  | "destructive"
  | "link";

export type ButtonSize =
  | "default"
  | "xs"
  | "sm"
  | "lg"
  | "icon"
  | "icon-sm";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;
};

const baseButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  whiteSpace: "nowrap",
  userSelect: "none",
  border: "1px solid transparent",
  outline: "none",
  cursor: "pointer",
  fontFamily: "inherit",
  fontWeight: 600,
  lineHeight: 1,
  flexShrink: 0,
  boxSizing: "border-box",
  transition:
    "background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease, box-shadow 0.15s ease",
};

const variantStyle: Record<ButtonVariant, CSSProperties> = {
  default: {
    background: "var(--primary-action-bg)",
    color: "var(--primary-action-fg)",
    borderColor: "var(--primary-action-bg)",
  },
  primary: {
    background: "var(--accent)",
    color: "var(--fg-on-accent)",
    borderColor: "var(--accent)",
  },
  outline: {
    background: "var(--bg-input)",
    color: "var(--text-primary)",
    borderColor: "var(--border-medium)",
  },
  secondary: {
    background: "var(--bg-subtle)",
    color: "var(--text-secondary)",
    borderColor: "var(--border-dim)",
  },
  ghost: {
    background: "transparent",
    color: "var(--text-secondary)",
    borderColor: "transparent",
  },
  destructive: {
    background: "var(--danger)",
    color: "#ffffff",
    borderColor: "var(--danger)",
  },
  link: {
    background: "transparent",
    color: "var(--accent)",
    borderColor: "transparent",
    textDecoration: "underline",
    textUnderlineOffset: 4,
  },
};

const hoverVariantStyle: Partial<Record<ButtonVariant, CSSProperties>> = {
  default: {
    background: "var(--primary-action-hover)",
    borderColor: "var(--primary-action-hover)",
  },
  primary: {
    background: "var(--accent-hover)",
    borderColor: "var(--accent-hover)",
  },
  outline: {
    background: "var(--bg-hover)",
    borderColor: "var(--border-strong)",
  },
  secondary: {
    background: "var(--bg-hover)",
    color: "var(--text-primary)",
  },
  ghost: {
    background: "var(--bg-hover)",
    color: "var(--text-primary)",
    borderColor: "var(--border-dim)",
  },
  destructive: {
    background: "color-mix(in srgb, var(--danger) 85%, black)",
    borderColor: "color-mix(in srgb, var(--danger) 85%, black)",
  },
  link: {
    color: "var(--accent-hover)",
  },
};

const sizeStyle: Record<ButtonSize, CSSProperties> = {
  default: {
    height: 32,
    minWidth: 72,
    padding: "0 14px",
    borderRadius: "var(--radius-md)",
    fontSize: 13,
  },
  xs: {
    height: 24,
    padding: "0 8px",
    borderRadius: "var(--radius-sm)",
    fontSize: 11,
    gap: 4,
  },
  sm: {
    height: 28,
    padding: "0 10px",
    borderRadius: "var(--radius-sm)",
    fontSize: 12,
    gap: 5,
  },
  lg: {
    height: 38,
    minWidth: 84,
    padding: "0 16px",
    borderRadius: "var(--radius-md)",
    fontSize: 14,
  },
  icon: {
    width: 32,
    minWidth: 32,
    height: 32,
    padding: 0,
    borderRadius: "var(--radius-md)",
  },
  "icon-sm": {
    width: 26,
    minWidth: 26,
    height: 26,
    padding: 0,
    borderRadius: "var(--radius-sm)",
  },
};

export function Button({
  type = "button",
  variant = "default",
  size = "default",
  active = false,
  disabled = false,
  style,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  children,
  ...props
}: ButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const showHover = hovered && !disabled;
  const resolvedVariant: ButtonVariant = active ? "secondary" : variant;

  const resolvedStyle: CSSProperties = {
    ...baseButtonStyle,
    ...variantStyle[resolvedVariant],
    ...(showHover ? (hoverVariantStyle[resolvedVariant] ?? null) : null),
    ...sizeStyle[size],
    ...(active
      ? {
          color: "var(--control-active-fg)",
          background: "var(--control-active-bg)",
          borderColor: "var(--border-strong)",
        }
      : null),
    ...(focused && !disabled
      ? {
          borderColor: "var(--border-focus)",
          boxShadow: "0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent)",
        }
      : null),
    ...(disabled
      ? {
          opacity: 0.45,
          cursor: "not-allowed",
          pointerEvents: "none",
        }
      : null),
    ...style,
  };

  return (
    <button
      type={type}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      style={resolvedStyle}
      onMouseEnter={(event) => {
        setHovered(true);
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        setHovered(false);
        onMouseLeave?.(event);
      }}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      {...props}
    >
      {children}
    </button>
  );
}

export function ButtonGroup({
  children,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role={props.role ?? "group"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
