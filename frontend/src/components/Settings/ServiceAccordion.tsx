import { useId, useState, type JSX, type ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import Pill from "../ui/Pill";
import { token } from "../ui/tokens";
import { Icon } from "../ui/Icon";
import { HeadingAboveContext } from "./SettingsShared";

/**
 * Who provides a service for this account (forgejo#321):
 * - `admin`: the instance's key or connection, set up by the admin for everyone
 * - `own`: the account's own key or connection
 * - `adminOwn`: both exist, and the own one is used
 * - `none`: nobody has set it up
 * `null` while the answer is still loading — no badge rather than a guess.
 */
export type ServiceState = "admin" | "own" | "adminOwn" | "none";

export interface ServiceItem {
  id: string;
  name: string;
  /** One line on what the service is for. */
  what?: string;
  state: ServiceState | null;
  /** The service's own card — its connection form, test button, quota. */
  body?: ReactNode;
}

export interface ServiceGroup {
  id: string;
  label: string;
  /** The domain's colour, as a dot beside the label. */
  color?: string;
  items: ServiceItem[];
  /** Under the items: a save bar, a pointer elsewhere. */
  footer?: ReactNode;
}

const BADGE: Record<ServiceState, { key: string; color: string; dashed?: boolean }> = {
  admin: { key: "settings:services.badge.admin", color: token("accent") },
  own: { key: "settings:services.badge.own", color: token("good") },
  adminOwn: { key: "settings:services.badge.own", color: token("good") },
  none: { key: "settings:services.badge.none", color: token("muted"), dashed: true },
};

/** The header line: "2 für alle aktiv · 1 eigener". */
export function summarise(items: readonly ServiceItem[]): { shared: number; own: number } {
  let shared = 0;
  let own = 0;
  for (const item of items) {
    if (item.state === "admin" || item.state === "adminOwn") shared += 1;
    if (item.state === "own" || item.state === "adminOwn") own += 1;
  }
  return { shared, own };
}

export function ServiceBadge({ state }: { state: ServiceState }): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const badge = BADGE[state];
  return (
    <Pill color={badge.color} dashed={badge.dashed}>
      {t(badge.key)}
    </Pill>
  );
}

/**
 * External services as accordions, one per domain plus "Bereichsübergreifend"
 * (tester, Discord 2026-10-18: the same kind of service sat in a different
 * place on every domain's page, and nothing said which ones the admin had
 * already set up for everyone).
 *
 * The header of a group answers the question the tester asked first — what is
 * already running — without opening it. A collapsed group keeps its cards
 * mounted (only hidden), because the cards load their own state and report it
 * up into the header; an unmounted card would leave the summary blank.
 */
export function ServiceAccordion({
  groups,
  initiallyOpen = [],
}: {
  groups: readonly ServiceGroup[];
  initiallyOpen?: readonly string[];
}): JSX.Element {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initiallyOpen));
  const toggle = (id: string): void =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      {groups
        .filter((g) => g.items.length > 0)
        .map((group) => (
          <AccordionGroup
            key={group.id}
            group={group}
            open={open.has(group.id)}
            onToggle={() => toggle(group.id)}
          />
        ))}
    </div>
  );
}

function AccordionGroup({
  group,
  open,
  onToggle,
}: {
  group: ServiceGroup;
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const coarse = useCoarsePointer();
  const panelId = useId();
  const { shared, own } = summarise(group.items);
  return (
    <div
      data-service-group={group.id}
      style={{
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card)",
        background: "var(--ts-surface)",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-center text-left"
        style={{
          gap: "var(--ts-space-md)",
          minHeight: coarse ? 56 : 48,
          padding: "0 var(--ts-space-lg)",
        }}
      >
        {group.color && (
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: "var(--ts-radius-pill)",
              background: group.color,
              flexShrink: 0,
            }}
          />
        )}
        <span className="flex-1" style={{ fontSize: 15, fontWeight: 700 }}>
          {group.label}
        </span>
        <span className="t-caption" data-service-summary="">
          {t("settings:services.summary", { shared, own })}
        </span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={16} />
      </button>
      <div
        id={panelId}
        hidden={!open}
        style={{ borderTop: "1px solid var(--ts-border)", padding: "var(--ts-space-lg)" }}
      >
        <ul className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
          {group.items.map((item) => (
            <li key={item.id} data-service={item.id} className="flex flex-col" style={{ gap: 8 }}>
              <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
                <span className="flex min-w-0 flex-1 flex-col" style={{ gap: 2 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--ts-text-bright)" }}>
                    {item.name}
                  </h3>
                  {item.what && <span className="t-caption">{item.what}</span>}
                </span>
                {item.state && <ServiceBadge state={item.state} />}
              </div>
              {item.state === "adminOwn" && (
                <p className="t-caption" data-own-overrides="">
                  {t("settings:services.ownOverrides")}
                </p>
              )}
              {/* The row names the service; a card titled the same leaves its
                  heading out. */}
              <HeadingAboveContext.Provider value={item.name}>
                {item.body}
              </HeadingAboveContext.Provider>
            </li>
          ))}
        </ul>
        {group.footer}
      </div>
    </div>
  );
}
