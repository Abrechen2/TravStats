import { useEffect, useState, type JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../../hooks/useTranslation";
import {
  fetchReadinessEntries,
  type ReadinessEntry,
  type ReadinessItem,
} from "../../../lib/api/readiness";
import { logger } from "../../../lib/logger";
import { profileDateTime } from "../../../lib/profileInstant";
import Button from "../../ui/Button";
import Pill from "../../ui/Pill";
import { token } from "../../ui/tokens";
import { readinessKey, TONE_COLOR, type ReadinessGroupId } from "./readinessModel";

/** Where an admin re-resolves stored zones (Wartung › Zeitmodell). */
const ZONE_FIX_ADDRESS = "/settings/wartung#timeModel";

interface ItemRowProps {
  item: ReadinessItem;
  group: ReadinessGroupId | "parked";
  isAdmin: boolean;
  demo: boolean;
  minHeight: number;
  href: string | null;
  /** Opened from a link that named this item: its entry list starts open. */
  initiallyOpen?: boolean;
  onSnooze: () => void;
  onOptOut: () => void;
  onClear: () => void;
}

/**
 * One readiness item. A verified "needs action" in the muss or empfohlen group
 * is drawn large (owner, 2026-11-23): a coloured edge for its severity, the
 * title with its count, why it matters, and ONE button that names the fix —
 * or, where the fix is per entry, the list of those entries, each linking to
 * its own page.
 */
export function ItemRow({
  item,
  group,
  isAdmin,
  demo,
  minHeight,
  href,
  initiallyOpen = false,
  onSnooze,
  onOptOut,
  onClear,
}: ItemRowProps): JSX.Element {
  const { t } = useTranslation(["readiness"]);
  const checked = profileDateTime(item.checkedAt);
  const unknown = item.status === "unknown";
  const active = group !== "ready" && group !== "parked";
  const prominent = active && group !== "blocked" && item.status === "needsAction";
  const tone = item.severity === "required" ? "problem" : "warning";
  const count = item.count ?? undefined;
  const actionLabel = item.actionKey
    ? t(readinessKey(item.actionKey), { count })
    : unknown
      ? t("readiness:checkNow")
      : t("readiness:openAction");
  const [entriesOpen, setEntriesOpen] = useState(initiallyOpen && item.entryList);

  return (
    <li
      data-item={item.id}
      data-group={group}
      data-prominent={prominent ? tone : undefined}
      style={{
        ...rowStyle,
        ...(prominent
          ? { borderLeft: `4px solid ${TONE_COLOR[tone]}`, padding: "var(--ts-space-lg)" }
          : {}),
      }}
    >
      <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
        <strong style={prominent ? { fontSize: 17 } : undefined}>
          {t(readinessKey(item.titleKey), { count })}
        </strong>
        {unknown && (
          <Pill color={token("muted")} dashed>
            {t("readiness:unchecked")}
          </Pill>
        )}
        {isAdmin && item.scope === "admin" && (
          <Pill color={token("muted")}>{t("readiness:scope.server")}</Pill>
        )}
      </div>
      <p className={prominent ? undefined : "t-caption"}>{t(readinessKey(item.consequenceKey))}</p>
      {unknown && !checked && <p className="t-caption">{t("readiness:neverChecked")}</p>}
      {checked && <p className="t-caption">{t("readiness:checkedAt", { time: checked })}</p>}
      {group === "blocked" && !href && <p className="t-caption">{t("readiness:blockedHint")}</p>}
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
        {item.entryList && active && group !== "blocked" ? (
          <Button
            variant={prominent ? "primary" : "secondary"}
            aria-expanded={entriesOpen}
            onClick={() => setEntriesOpen((v) => !v)}
          >
            {entriesOpen ? t("readiness:entries.hide") : actionLabel}
          </Button>
        ) : (
          href &&
          (prominent ? (
            <Link to={href} data-primary-action="" style={primaryLinkStyle(minHeight)}>
              {actionLabel}
            </Link>
          ) : (
            <Link
              to={href}
              className="underline"
              style={{
                minHeight,
                display: "inline-flex",
                alignItems: "center",
                color: "var(--ts-accent)",
              }}
            >
              {actionLabel}
            </Link>
          ))
        )}
        {active && (
          <Button variant="secondary" disabled={demo} onClick={onSnooze}>
            {t("readiness:snooze")}
          </Button>
        )}
        {active && item.optOutAllowed && item.severity !== "required" && (
          <Button variant="secondary" disabled={demo} onClick={onOptOut}>
            {t("readiness:optOut")}
          </Button>
        )}
        {group === "parked" && (
          <Button variant="secondary" disabled={demo} onClick={onClear}>
            {t("readiness:showAgain")}
          </Button>
        )}
      </div>
      {entriesOpen && (
        <EntryList
          itemId={item.id}
          minHeight={minHeight}
          zoneFix={isAdmin && item.id === "user.zoneMismatch" ? ZONE_FIX_ADDRESS : null}
        />
      )}
    </li>
  );
}

type EntriesLoad =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ok"; total: number; entries: ReadinessEntry[] };

function EntryList({
  itemId,
  minHeight,
  zoneFix,
}: {
  itemId: string;
  minHeight: number;
  zoneFix: string | null;
}): JSX.Element {
  const { t } = useTranslation(["readiness"]);
  const [load, setLoad] = useState<EntriesLoad>({ state: "loading" });
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const data = await fetchReadinessEntries(itemId);
        if (live) setLoad({ state: "ok", ...data });
      } catch (error) {
        // Said on the page AND in the console (owner, 2026-11-18): never an empty list.
        logger.warn("readiness entries read failed", error);
        if (live) setLoad({ state: "error" });
      }
    })();
    return () => {
      live = false;
    };
  }, [itemId]);
  if (load.state === "loading") {
    return (
      <p className="t-caption" role="status">
        {t("readiness:entries.loading")}
      </p>
    );
  }
  if (load.state === "error") {
    return (
      <p role="alert" style={{ color: "var(--ts-bad)" }}>
        {t("readiness:entries.error")}
      </p>
    );
  }
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
      <ul
        data-entries={itemId}
        className="flex flex-col"
        style={{ listStyle: "none", padding: 0, margin: 0, gap: 2 }}
      >
        {load.entries.map((entry) => (
          <li key={`${entry.kind}:${entry.id}`}>
            <Link
              to={entry.href}
              className="flex items-center underline"
              style={{ minHeight, gap: "var(--ts-space-sm)", color: "var(--ts-accent)" }}
            >
              <span>{entry.label}</span>
              {entry.date && (
                <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
                  {entry.date.slice(0, 10)}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {load.total > load.entries.length && (
        <p className="t-caption">
          {t("readiness:entries.more", { shown: load.entries.length, total: load.total })}
        </p>
      )}
      {zoneFix && (
        <Link to={zoneFix} className="underline" style={{ color: "var(--ts-accent)", minHeight }}>
          {t("readiness:entries.zoneFix")}
        </Link>
      )}
    </div>
  );
}

/** The primary Button's skin on a link: navigation stays a link (middle-click, a11y). */
const primaryLinkStyle = (minHeight: number) =>
  ({
    display: "inline-flex",
    alignItems: "center",
    minHeight: Math.max(minHeight, 44),
    padding: "0 var(--ts-space-lg)",
    borderRadius: "var(--ts-radius-button)",
    background: "var(--ts-accent)",
    color: "var(--ts-accent-text)",
    border: "1px solid var(--ts-accent)",
    fontWeight: 700,
    fontSize: 16,
  }) as const;

const rowStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--ts-space-sm)",
  padding: "var(--ts-space-md)",
  background: "var(--ts-tile)",
  borderRadius: "var(--ts-radius-card)",
} as const;
