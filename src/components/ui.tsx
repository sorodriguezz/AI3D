import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost";

export function Button({ variant = "secondary", size = "md", className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-40 disabled:pointer-events-none cursor-pointer",
        size === "sm" && "h-7 px-2.5 text-[12px]",
        size === "md" && "h-8 px-3 text-[13px]",
        size === "lg" && "h-10 px-4 text-[13.5px]",
        variant === "primary" && "bg-accent text-accent-ink hover:brightness-95",
        variant === "secondary" && "bg-surface-2 text-fg border border-line hover:bg-surface-3 hover:border-line-strong",
        variant === "ghost" && "text-muted hover:text-fg hover:bg-surface-2",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex size-8 items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer",
        active ? "bg-accent-soft text-accent-text" : "text-muted hover:text-fg hover:bg-surface-2",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
      <h2 className="text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">{children}</h2>
      {aside}
    </div>
  );
}

export function Pill({ tone = "neutral", children, className }: { tone?: "neutral" | "ok" | "warn" | "err" | "info" | "accent"; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 h-5 text-[10.5px] font-medium whitespace-nowrap",
        tone === "neutral" && "bg-surface-3 text-muted",
        tone === "ok" && "bg-ok/12 text-ok",
        tone === "warn" && "bg-warn/12 text-warn",
        tone === "err" && "bg-err/12 text-err",
        tone === "info" && "bg-info/12 text-info",
        tone === "accent" && "bg-accent-soft text-accent-text",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-[10px] text-muted">{children}</kbd>;
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <path d="M32 12 50 22.5v19L32 52 14 41.5v-19Z" fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
      <path d="M32 32 50 22.5M32 32 14 22.5M32 32v20" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Campo de texto que se edita en el lugar y confirma con Enter o al salir. */
export function InlineEdit({ value, onCommit, className }: { value: string; onCommit: (v: string) => void; className?: string }) {
  return (
    <input
      key={value}
      defaultValue={value}
      onBlur={(e) => e.target.value.trim() && e.target.value !== value && onCommit(e.target.value.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          (e.target as HTMLInputElement).value = value;
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cx("min-w-0 rounded-md bg-transparent px-1.5 outline-none hover:bg-surface-2 focus:bg-surface-2 focus:ring-1 focus:ring-line-strong", className)}
      spellCheck={false}
    />
  );
}
