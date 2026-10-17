import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "ghost" | "secondary" | "overlay" | "solid";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  ghost: "text-ink-soft hover:bg-surface-sunken hover:text-ink",
  secondary:
    "border border-line-strong bg-surface text-ink-soft hover:border-ink-muted hover:text-ink",
  // Sits on top of photographs.
  overlay:
    "bg-scrim/45 text-on-photo backdrop-blur-md hover:bg-scrim/65",
  solid: "bg-ink text-paper hover:bg-ink-soft",
};

const sizes: Record<Size, { box: string; icon: string }> = {
  sm: { box: "h-8 w-8", icon: "h-4 w-4" },
  md: { box: "h-10 w-10", icon: "h-[18px] w-[18px]" },
  lg: { box: "h-12 w-12", icon: "h-5 w-5" },
};

interface IconButtonProps extends ComponentPropsWithoutRef<"button"> {
  icon: LucideIcon;
  /** Accessible name, also shown as the native tooltip. */
  label: string;
  variant?: Variant;
  size?: Size;
  active?: boolean;
  loading?: boolean;
  iconClassName?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      icon: Icon,
      label,
      variant = "ghost",
      size = "md",
      active,
      loading,
      className,
      iconClassName,
      type = "button",
      disabled,
      ...rest
    },
    ref,
  ) {
    const s = sizes[size];
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        aria-pressed={active}
        disabled={disabled || loading}
        className={cn(
          "touch-target inline-flex shrink-0 items-center justify-center rounded-full",
          "transition-[background-color,color,transform] duration-150 ease-out-soft active:scale-95",
          "disabled:pointer-events-none disabled:opacity-50",
          s.box,
          variants[variant],
          active && variant === "ghost" && "bg-surface-sunken text-ink",
          className,
        )}
        {...rest}
      >
        {loading ? (
          <Loader2 className={cn(s.icon, "animate-spin")} aria-hidden />
        ) : (
          <Icon className={cn(s.icon, iconClassName)} aria-hidden />
        )}
      </button>
    );
  },
);
