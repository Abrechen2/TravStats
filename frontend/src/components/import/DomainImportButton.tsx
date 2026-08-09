import { useState } from "react";
import type { JSX, ReactNode } from "react";
import DomainImportPanel from "./DomainImportPanel";
import type { DomainImportAdapter } from "./types";

interface DomainImportButtonProps {
  adapter: DomainImportAdapter;
  onItemsCreated: () => void | Promise<void>;
  /** Override the default trigger label / styling. */
  children?: ReactNode;
  className?: string;
  /** Trigger icon. Defaults to 📥; pass a different one where this button
   *  sits next to the central-import-hub link, so the two never read alike. */
  icon?: string;
}

/**
 * Convenience trigger: a button that opens `<DomainImportPanel>`.
 * Pages can also drive the panel directly if they need their own trigger.
 */
export default function DomainImportButton({
  adapter,
  onItemsCreated,
  children,
  className,
  icon = "📥",
}: DomainImportButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerLabel = children ?? adapter.panelTitle;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "flex items-center gap-2 whitespace-nowrap rounded-md border border-border bg-(--bg-surface) px-3 py-2 text-sm text-(--text-primary) hover:border-(--accent)"
        }
      >
        <span aria-hidden="true">{icon}</span>
        <span>{triggerLabel}</span>
      </button>
      <DomainImportPanel
        open={open}
        onClose={() => setOpen(false)}
        onItemsCreated={onItemsCreated}
        adapter={adapter}
      />
    </>
  );
}
