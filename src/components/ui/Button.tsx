import Link from "next/link";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-ink-soft",
  accent: "bg-accent text-on-photo hover:bg-accent-strong",
  secondary:
    "border border-line-strong bg-surface text-ink hover:border-ink-muted",
  ghost: "text-ink-soft hover:bg-surface-sunken hover:text-ink",
  danger: "bg-danger text-on-photo hover:bg-danger/90",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

const iconSizes: Record<Size, string> = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-[18px] w-[18px]",
};

interface StyleProps {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
}

export function buttonClasses({
  variant = "secondary",
  size = "md",
  className,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
}) {
  return cn(
    "touch-target inline-flex select-none items-center justify-center whitespace-nowrap rounded-full font-medium",
    "transition-[background-color,border-color,color,transform] duration-150 ease-out-soft active:scale-[0.98]",
    "disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    sizes[size],
    className,
  );
}

function Content({
  icon: Icon,
  iconRight: IconRight,
  loading,
  size = "md",
  children,
}: StyleProps & { children?: React.ReactNode }) {
  const iconClass = iconSizes[size];
  return (
    <>
      {loading ? (
        <Loader2 className={cn(iconClass, "animate-spin")} aria-hidden />
      ) : (
        Icon && <Icon className={iconClass} aria-hidden />
      )}
      {children}
      {IconRight && <IconRight className={iconClass} aria-hidden />}
    </>
  );
}

type ButtonProps = StyleProps & ComponentPropsWithoutRef<"button">;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant,
      size,
      icon,
      iconRight,
      loading,
      className,
      children,
      disabled,
      type = "button",
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled === true || loading === true}
        aria-busy={loading === true ? true : undefined}
        className={buttonClasses({ variant, size, className })}
        {...rest}
      >
        <Content
          icon={icon}
          iconRight={iconRight}
          loading={loading}
          size={size}
        >
          {children}
        </Content>
      </button>
    );
  },
);

type ButtonLinkProps = StyleProps &
  Omit<ComponentPropsWithoutRef<typeof Link>, "className"> & {
    className?: string;
  };

export function ButtonLink({
  variant,
  size,
  icon,
  iconRight,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={buttonClasses({ variant, size, className })} {...rest}>
      <Content icon={icon} iconRight={iconRight} size={size}>
        {children}
      </Content>
    </Link>
  );
}
