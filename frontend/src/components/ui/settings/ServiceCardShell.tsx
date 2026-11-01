import { useId, useState, type JSX, type ReactNode } from "react";
import { useTranslation } from "../../../hooks/useTranslation";

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

/** B12: a service card, closed or open, or status only. */
export function ServiceCardShell({
  title,
  pills,
  statusOnly = false,
  defaultOpen = false,
  children,
}: ServiceCardShellProps): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const [open, setOpen] = useState(defaultOpen);
  // Once opened the body stays mounted (hidden when closed): its unsaved groups
  // must not vanish, unasked, with a click on the chevron.
  const [everOpened, setEverOpened] = useState(defaultOpen);
  const bodyId = useId();
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
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => {
            setEverOpened(true);
            setOpen((v) => !v);
          }}
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
          <span aria-hidden="true" style={{ color: "var(--ts-muted)" }}>
            {open ? "⌃" : "⌄"}
          </span>
          <span className="sr-only">
            {open ? t("settings:blocks.card.close") : t("settings:blocks.card.open")}
          </span>
        </button>
      )}
      {!statusOnly && (open || everOpened) ? (
        <div
          id={bodyId}
          hidden={!open}
          style={{ padding: "0 var(--ts-space-lg) var(--ts-space-lg)" }}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}
