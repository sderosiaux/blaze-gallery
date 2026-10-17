"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

const control =
  "w-full rounded-md border border-line-strong bg-surface text-sm text-ink placeholder:text-ink-muted " +
  "transition-[border-color,box-shadow] duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 " +
  "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-muted";

export const Input = forwardRef<
  HTMLInputElement,
  ComponentPropsWithoutRef<"input">
>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn(control, "h-10 px-3", className)}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  ComponentPropsWithoutRef<"textarea">
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        control,
        "min-h-[88px] px-3 py-2 leading-relaxed",
        className,
      )}
      {...rest}
    />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  ComponentPropsWithoutRef<"select">
>(function Select({ className, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        control,
        "h-10 appearance-none bg-no-repeat pl-3 pr-9",
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%2371717A' stroke-width='1.5' viewBox='0 0 24 24'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundPosition: "right 0.75rem center",
      }}
      {...rest}
    >
      {children}
    </select>
  );
});

interface FieldProps {
  label: React.ReactNode;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-ink-muted">{hint}</p>
      )}
    </div>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  id: string;
  disabled?: boolean;
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  id,
  disabled,
}: SwitchProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs text-ink-muted">
            {description}
          </span>
        )}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => {
          onChange(!checked);
        }}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150",
          checked ? "bg-ink" : "bg-line-strong",
          disabled && "opacity-50",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "inline-block h-5 w-5 rounded-full bg-surface shadow-lift transition-transform duration-200 ease-out-soft",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
