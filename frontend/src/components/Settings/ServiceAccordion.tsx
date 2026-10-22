import { useEffect, useId, useState, type JSX, type ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import Pill from "../ui/Pill";
import { token } from "../ui/tokens";
import { Icon } from "../ui/Icon";
import { HeadingAboveContext } from "./SettingsShared";
import { foldForSearch } from "../../pages/Settings/settingsSearchMatch";
import type { LlmAvailability } from "../../hooks/useHasLlm";

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
  /** Why the service is not available although something is stored. */
  notice?: string;
  /**
   * The service's own card — its connection form, test button, quota. With a
   * state, it folds behind the row's action; without one (a pointer, a
   * service nobody can set up from here) it is always shown.
   */
  body?: ReactNode;
  /**
   * What the row's action does when the form is not in the row — the account's
   * own key forms and the rail switches live under the group. Takes
   * precedence over folding the body.
   */
  onAction?: () => void;
  /** The body is a pointer elsewhere, shown under the row and never folded. */
  inline?: boolean;
}

/**
 * Personal services (`personal`) speak from the account's side ("Vom Admin für
 * alle", "Eigener Schlüssel"); administration (`admin`) from the instance's.
 */
export type ServiceSurface = "personal" | "admin";

export interface ServiceGroup {
  id: string;
  label: string;
  /** The domain's colour, as a dot beside the label. */
  color?: string;
  items: ServiceItem[];
  /** Under the items: a save bar, a pointer elsewhere. */
  footer?: ReactNode;
}

/**
 * The row's action, by who provides the service (forgejo#321 prototype): one
 * word per state, the same on every row, so the reader never has to work out
 * what a button next to a badge will do.
 */
const ACTION: Record<ServiceSurface, Record<ServiceState, string>> = {
  personal: {
    admin: "settings:services.action.useOwn",
    own: "settings:services.action.edit",
    adminOwn: "settings:services.action.edit",
    none: "settings:services.action.setUp",
  },
  admin: {
    admin: "settings:services.action.edit",
    own: "settings:services.action.edit",
    adminOwn: "settings:services.action.edit",
    none: "settings:services.action.setUp",
  },
};

const BADGE: Record<ServiceState, { key: string; color: string; dashed?: boolean }> = {
  admin: { key: "settings:services.badge.admin", color: token("accent") },
  own: { key: "settings:services.badge.own", color: token("good") },
  adminOwn: { key: "settings:services.badge.own", color: token("good") },
  none: { key: "settings:services.badge.none", color: token("muted"), dashed: true },
};

/**
 * The KI-Parser row: the instance's model is the admin's for everyone, or
 * absent ("disabled" — switched off — counts as absent); unknown while the
 * capability request is outstanding.
 */
export function llmServiceState(hasLlm: LlmAvailability): ServiceState | null {
  if (hasLlm === null) return null;
  return hasLlm === true ? "admin" : "none";
}

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

export function ServiceBadge({
  state,
  surface = "personal",
}: {
  state: ServiceState;
  surface?: ServiceSurface;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const badge = BADGE[state];
  // In administration the admin's own key is simply "eingerichtet".
  const key =
    surface === "admin" && state === "admin" ? "settings:services.badge.setUp" : badge.key;
  return (
    <Pill color={badge.color} dashed={badge.dashed}>
      {t(key)}
    </Pill>
  );
}

/**
 * The service a deep link names: the settings search appends the keyword it
 * matched (`&match=OpenRouteService-Schlüssel`). An item matches when its name
 * is inside the keyword or the keyword inside its name. Read from the address
 * bar, not the router, because the accordion is also drawn outside one.
 */
function namedItem(groups: readonly ServiceGroup[]): { groupId: string; itemId: string } | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("match");
  const match = raw ? foldForSearch(raw) : "";
  if (match.length < 3) return null;
  for (const group of groups) {
    for (const item of group.items) {
      const name = foldForSearch(item.name);
      if (name.length >= 3 && (match.includes(name) || name.includes(match))) {
        return { groupId: group.id, itemId: item.id };
      }
    }
  }
  return null;
}

/**
 * External services as accordions, one per domain plus "Bereichsübergreifend"
 * (tester, Discord 2026-10-18: the same kind of service sat in a different
 * place on every domain's page, and nothing said which ones the admin had
 * already set up for everyone).
 *
 * The header of a group answers the question the tester asked first — what is
 * already running — without opening it. One group is open at a time (the
 * approved prototype): the page stays an index rather than a wall of forms. A
 * collapsed group keeps its cards mounted (only hidden), because the cards
 * load their own state and report it up into the header; an unmounted card
 * would leave the summary blank.
 */
export function ServiceAccordion({
  groups,
  initiallyOpen = null,
  surface = "personal",
}: {
  groups: readonly ServiceGroup[];
  /** The group open on arrival; a link naming a service opens that one instead. */
  initiallyOpen?: string | null;
  surface?: ServiceSurface;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const named = namedItem(groups);
  const namedGroup = named?.groupId ?? null;
  const namedId = named?.itemId ?? null;
  const [open, setOpen] = useState<string | null>(() => namedGroup ?? initiallyOpen);
  // A link that names a service inside a collapsed group opens that group and
  // brings the service into view (beta.22 UAT: the search hit landed on a
  // closed "Straßenrouting"). The scroll waits a tick so it lands after the
  // page's own scroll to the section.
  useEffect(() => {
    if (!namedGroup || !namedId) return;
    setOpen(namedGroup);
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-service="${namedId}"]`);
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [namedGroup, namedId]);
  const shown = groups.filter((g) => g.items.length > 0);
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <ServiceLegend surface={surface} />
      {shown.map((group) => (
        <AccordionGroup
          key={group.id}
          group={group}
          surface={surface}
          open={open === group.id}
          namedId={namedGroup === group.id ? namedId : null}
          onToggle={() => setOpen((prev) => (prev === group.id ? null : group.id))}
          countLabel={t("settings:services.count", { count: group.items.length })}
        />
      ))}
    </div>
  );
}

/** What the badges mean, once, above the groups (forgejo#321 prototype). */
function ServiceLegend({ surface }: { surface: ServiceSurface }): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const entries: Array<{ state: ServiceState; key: string }> =
    surface === "personal"
      ? [
          { state: "admin", key: "settings:services.legend.admin" },
          { state: "own", key: "settings:services.legend.own" },
        ]
      : [
          { state: "admin", key: "settings:services.legend.adminSurface" },
          { state: "none", key: "settings:services.legend.none" },
        ];
  return (
    <p
      className="t-caption flex flex-wrap items-center"
      data-service-legend={surface}
      style={{ gap: "var(--ts-space-sm) var(--ts-space-lg)" }}
    >
      {entries.map((entry) => (
        <span
          key={entry.state}
          className="inline-flex items-center"
          style={{ gap: "var(--ts-space-xs)" }}
        >
          <ServiceBadge state={entry.state} surface={surface} />
          <span>{t(entry.key)}</span>
        </span>
      ))}
    </p>
  );
}

function AccordionGroup({
  group,
  surface,
  open,
  namedId,
  onToggle,
  countLabel,
}: {
  group: ServiceGroup;
  surface: ServiceSurface;
  open: boolean;
  /** The service a link named in this group: its card opens with it. */
  namedId: string | null;
  onToggle: () => void;
  countLabel: string;
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
        className="flex w-full flex-wrap items-center text-left"
        style={{
          gap: "var(--ts-space-xs) var(--ts-space-md)",
          minHeight: coarse ? 56 : 48,
          padding: "var(--ts-space-sm) var(--ts-space-lg)",
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
        <span className="t-caption" data-service-count="">
          {countLabel}
        </span>
        <span className="t-caption" data-service-summary="">
          {surface === "admin"
            ? t("settings:services.summaryAdmin", { shared })
            : t("settings:services.summary", { shared, own })}
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
            <ServiceRow
              key={item.id}
              item={item}
              surface={surface}
              initiallyOpen={item.id === namedId}
            />
          ))}
        </ul>
        {group.footer ? <div data-service-footer={group.id}>{group.footer}</div> : null}
      </div>
    </div>
  );
}

function ServiceRow({
  item,
  surface,
  initiallyOpen,
}: {
  item: ServiceItem;
  surface: ServiceSurface;
  initiallyOpen: boolean;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const coarse = useCoarsePointer();
  const bodyId = useId();
  // A row without a state has no action to fold its card behind: a pointer
  // elsewhere, or a card that says itself what it needs.
  const folds = item.state !== null && item.body !== undefined && !item.onAction && !item.inline;
  const [bodyOpen, setBodyOpen] = useState(initiallyOpen);
  useEffect(() => {
    if (initiallyOpen) setBodyOpen(true);
  }, [initiallyOpen]);
  const hasAction = item.state !== null && (item.onAction !== undefined || folds);
  return (
    <li data-service={item.id} className="flex flex-col" style={{ gap: 8 }}>
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
        <span className="flex min-w-0 flex-1 flex-col" style={{ gap: 2 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--ts-text-bright)" }}>
            {item.name}
          </h3>
          {item.what && <span className="t-caption">{item.what}</span>}
        </span>
        {item.state && <ServiceBadge state={item.state} surface={surface} />}
        {hasAction && item.state && (
          <button
            type="button"
            className="btn-secondary"
            data-service-action={item.state}
            aria-expanded={folds ? bodyOpen : undefined}
            aria-controls={folds ? bodyId : undefined}
            onClick={() => (item.onAction ? item.onAction() : setBodyOpen((v) => !v))}
            style={{ minHeight: coarse ? "var(--ts-size-touch-min)" : undefined }}
          >
            {t(ACTION[surface][item.state])}
          </button>
        )}
      </div>
      {item.notice && (
        <p className="t-caption" role="status" style={{ color: token("warn") }}>
          {item.notice}
        </p>
      )}
      {item.state === "adminOwn" && (
        <p className="t-caption" data-own-overrides="">
          {t("settings:services.ownOverrides")}
        </p>
      )}
      {item.body !== undefined && (
        // The row names the service; a card titled the same leaves its heading
        // out. Folded cards stay mounted: they report their state up.
        <div id={bodyId} hidden={folds && !bodyOpen} data-service-body={item.id}>
          <HeadingAboveContext.Provider value={item.name}>{item.body}</HeadingAboveContext.Provider>
        </div>
      )}
    </li>
  );
}
