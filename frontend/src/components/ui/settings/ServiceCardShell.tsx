import { useState, type JSX, type ReactNode } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import Dialog from "../Dialog";
import { hasDirtyGroups, usePendingLeave } from "./leaveGuard";

interface ServiceCardShellProps {
  title: ReactNode;
  /** Pills for the state: "Verbunden", "Vom Admin abgeschaltet". */
  pills?: ReactNode;
  /**
   * Status only: an account that has nothing to set here sees the card without
   * a chevron and without a body — there is nothing to open.
   */
  statusOnly?: boolean;
  defaultOpen?: boolean;
  children?: ReactNode;
}

/**
 * B12: a service card. Closed it is a tile — name, purpose, status pill. Opened (settings v3 S5b,
 * as the prototype draws it) it is a dialog over the page, not a body that pushes the grid
 * around: the card's settings, one "Fertig". An account that has nothing to set sees the tile
 * without a button.
 */
export function ServiceCardShell({
  title,
  pills,
  statusOnly = false,
  defaultOpen = false,
  children,
}: ServiceCardShellProps): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const [open, setOpen] = useState(defaultOpen);
  // Closing unmounts the card's forms; unsaved input asks first instead of vanishing.
  usePendingLeave();
  const dirty = open && hasDirtyGroups();
  const head = (
    <>
      <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ts-text-bright)" }}>{title}</span>
      <span className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
        {pills}
      </span>
    </>
  );
  return (
    <section
      data-service-card={statusOnly ? "status" : open ? "open" : "closed"}
      style={{
        background: "var(--ts-surface)",
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card)",
      }}
    >
      {statusOnly ? (
        <div
          className="flex flex-wrap items-center justify-between"
          style={{ gap: "var(--ts-space-md)", padding: "var(--ts-space-lg)" }}
        >
          {head}
        </div>
      ) : (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="flex w-full flex-wrap items-center justify-between"
          style={{
            gap: "var(--ts-space-md)",
            padding: "var(--ts-space-lg)",
            minHeight: "var(--ts-size-touch-min)",
            background: "none",
            border: 0,
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          {head}
          <span className="sr-only">{t("settings:blocks.card.open")}</span>
        </button>
      )}
      {!statusOnly ? (
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title={title}
          closeLabel={t("settings:blocks.card.close")}
          dismissLabel={t("settings:blocks.card.done")}
          maxWidth={680}
          dirty={dirty}
        >
          <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
            <span className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
              {pills}
            </span>
            {children}
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
