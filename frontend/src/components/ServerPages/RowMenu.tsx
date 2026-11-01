import { useState, type JSX, type ReactNode } from "react";
import { Icon } from "../ui/Icon";

/** A row's "…" menu: rare and destructive actions stay one click away, not in the row. */
export function RowMenu({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-block"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--ts-radius-button)]"
        style={{ color: "var(--ts-muted)" }}
      >
        <Icon name="ellipsis" size={16} />
      </button>
      {open ? (
        <span
          role="menu"
          className="absolute right-0 z-30 mt-1 flex min-w-48 flex-col p-1 text-left shadow-xl"
          style={{
            background: "var(--ts-surface)",
            border: "1px solid var(--ts-border)",
            borderRadius: "var(--ts-radius-button)",
          }}
        >
          {children(() => setOpen(false))}
        </span>
      ) : null}
    </span>
  );
}

export function MenuItem({
  onClick,
  danger = false,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="whitespace-nowrap rounded-[var(--ts-radius-button)] px-3 py-2 text-left text-sm hover:bg-[var(--ts-surface2)]"
      style={{ color: danger ? "var(--ts-bad)" : "var(--ts-text-bright)" }}
    >
      {children}
    </button>
  );
}
