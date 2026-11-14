import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { Link } from "react-router-dom";

import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";
import { useIsDemoAccount } from "../../../hooks/useIsDemoAccount";
import { useTranslation } from "../../../hooks/useTranslation";
import {
  acknowledgeReadinessNote,
  clearReadinessItemState,
  fetchReadiness,
  optOutReadinessItem,
  snoozeReadinessItem,
  type ReadinessItem,
  type ReadinessNote,
  type ReadinessResponse,
} from "../../../lib/api/readiness";
import { profileDateTime } from "../../../lib/profileInstant";
import { resolveAddress } from "../../../pages/Settings/area/redirects";
import { now } from "../../../shared/time";
import { useAuthStore } from "../../../store/authStore";
import Button from "../../ui/Button";
import Chip from "../../ui/Chip";
import Pill from "../../ui/Pill";
import { token } from "../../ui/tokens";
import { SectionCard } from "../SettingsShared";
import {
  actionFor,
  groupReadiness,
  readinessKey,
  READINESS_GROUP_ORDER,
  type ReadinessGroupId,
} from "./readinessModel";

type Load = { state: "loading" } | { state: "error" } | { state: "ok"; data: ReadinessResponse };

const DAY_MS = 24 * 60 * 60 * 1000;

/** "2.8.0-rc.30" → "2.8": the heading names the release line, not the build. */
function releaseLine(version: string): string {
  const [major, minor] = version.split(/[.-]/);
  return minor === undefined ? version : `${major}.${minor}`;
}

/**
 * Einrichtung & Zustand — what is missing now and what changed in an update
 * (spec 2026-11-14-setup-readiness-design). Everything the page shows comes
 * from `GET /readiness`; a click only writes a state (snooze, opt-out, ack)
 * and the page re-reads. Items clear from server state, never from a click.
 */
export default function ReadinessSection(): JSX.Element {
  const { t } = useTranslation(["readiness", "common"]);
  const coarse = useCoarsePointer();
  const demo = useIsDemoAccount();
  const isAdmin = useAuthStore((s) => s.user?.isAdmin === true);
  const { isEnabled } = useEnabledDomains();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [writeFailed, setWriteFailed] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setLoad({ state: "ok", data: await fetchReadiness() });
    } catch {
      setLoad({ state: "error" });
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const write = async (action: () => Promise<void>): Promise<void> => {
    setWriteFailed(false);
    try {
      await action();
    } catch {
      setWriteFailed(true);
      return;
    }
    await reload();
  };

  const hrefOf = useCallback(
    (address: string): string => {
      const url = new URL(address, "http://localhost");
      return resolveAddress({
        pathname: url.pathname,
        search: url.search,
        hash: url.hash,
        isAdmin,
        isDomainOn: isEnabled,
        lastPage: null,
      }).to;
    },
    [isAdmin, isEnabled]
  );

  const groups = useMemo(
    () => (load.state === "ok" ? groupReadiness(load.data, isAdmin, now().getTime()) : null),
    [load, isAdmin]
  );

  if (load.state === "loading") {
    return (
      <SectionCard>
        <p className="t-caption" role="status">
          {t("readiness:loading")}
        </p>
      </SectionCard>
    );
  }
  if (load.state === "error" || !groups) {
    // Its own state: a failed read must never look like "alles bereit".
    return (
      <SectionCard>
        <div role="alert" className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
          <strong>{t("readiness:error.title")}</strong>
          <p className="t-caption">{t("readiness:error.body")}</p>
          <div>
            <Button variant="secondary" onClick={() => void reload()}>
              {t("readiness:error.retry")}
            </Button>
          </div>
        </div>
      </SectionCard>
    );
  }

  const data = load.data;
  const minHeight = coarse ? 44 : 32;
  const itemsOf = (id: ReadinessGroupId): ReadinessItem[] | null =>
    id === "new" ? null : groups[id];
  const count = (id: ReadinessGroupId): number =>
    id === "new" ? groups.new.length : groups[id].length;
  const jump = (id: ReadinessGroupId): void => {
    document.getElementById(`readiness-group-${id}`)?.scrollIntoView({ behavior: "smooth" });
  };
  const noteAction = (note: ReadinessNote): string | null => {
    if (note.action?.kind === "address") return note.action.address;
    if (note.action?.kind === "check") {
      const check = data.items.find((i) => i.id === (note.action as { checkId: string }).checkId);
      return check ? actionFor(check, isAdmin) : null;
    }
    return null;
  };

  return (
    <SectionCard>
      <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
        <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
          {READINESS_GROUP_ORDER.filter((id) => count(id) > 0).map((id) => (
            <Chip key={id} meta={String(count(id))} onClick={() => jump(id)}>
              {t(`readiness:summary.${id}`, { line: releaseLine(data.runningVersion) })}
            </Chip>
          ))}
        </div>
        {writeFailed && (
          <p role="alert" className="t-caption">
            {t("readiness:writeFailed")}
          </p>
        )}
        {READINESS_GROUP_ORDER.every((id) => count(id) === 0) && groups.parked.length === 0 && (
          <p className="t-caption">{t("readiness:empty")}</p>
        )}
        {READINESS_GROUP_ORDER.map((id) => {
          if (count(id) === 0) return null;
          const heading = t(`readiness:group.${id}`, { line: releaseLine(data.runningVersion) });
          const body =
            id === "new"
              ? groups.new.map((note) => {
                  const href = noteAction(note);
                  const showAck = note.action?.kind !== "check";
                  return (
                    <li key={note.id} data-note={note.id} style={rowStyle}>
                      <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
                        <Pill color={token("accent")}>{note.version}</Pill>
                      </div>
                      <p>{t(readinessKey(note.beforeKey))}</p>
                      <p>
                        <strong>{t(readinessKey(note.afterKey))}</strong>
                      </p>
                      <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
                        {href && (
                          <Link
                            to={hrefOf(href)}
                            className="underline"
                            style={{
                              minHeight,
                              display: "inline-flex",
                              alignItems: "center",
                              color: "var(--ts-accent-text)",
                            }}
                          >
                            {t("readiness:openAction")}
                          </Link>
                        )}
                        {showAck && (
                          <Button
                            variant="secondary"
                            disabled={demo}
                            onClick={() => void write(() => acknowledgeReadinessNote(note.id))}
                          >
                            {t("readiness:note.ack")}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })
              : itemsOf(id)!.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    group={id}
                    isAdmin={isAdmin}
                    demo={demo}
                    minHeight={minHeight}
                    href={(() => {
                      const a = actionFor(item, isAdmin);
                      return a ? hrefOf(a) : null;
                    })()}
                    onSnooze={() =>
                      void write(() =>
                        snoozeReadinessItem(
                          item.id,
                          new Date(now().getTime() + DAY_MS).toISOString()
                        )
                      )
                    }
                    onOptOut={() => void write(() => optOutReadinessItem(item.id))}
                    onClear={() => void write(() => clearReadinessItemState(item.id))}
                  />
                ));
          const list = (
            <ul
              className="flex flex-col"
              style={{ gap: "var(--ts-space-md)", listStyle: "none", padding: 0, margin: 0 }}
            >
              {body}
            </ul>
          );
          return (
            <section key={id} id={`readiness-group-${id}`} aria-label={heading}>
              {id === "ready" ? (
                <details>
                  <summary style={{ minHeight, cursor: "pointer" }}>
                    {heading} ({count(id)})
                  </summary>
                  {list}
                </details>
              ) : (
                <>
                  <h3 className="t-label" style={{ marginBottom: "var(--ts-space-sm)" }}>
                    {heading}
                  </h3>
                  {list}
                </>
              )}
            </section>
          );
        })}
        {groups.parked.length > 0 && (
          <section id="readiness-group-parked" aria-label={t("readiness:group.parked")}>
            <details>
              <summary style={{ minHeight, cursor: "pointer" }}>
                {t("readiness:group.parked")} ({groups.parked.length})
              </summary>
              <ul
                className="flex flex-col"
                style={{ gap: "var(--ts-space-md)", listStyle: "none", padding: 0, margin: 0 }}
              >
                {groups.parked.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    group="parked"
                    isAdmin={isAdmin}
                    demo={demo}
                    minHeight={minHeight}
                    href={null}
                    onSnooze={() => undefined}
                    onOptOut={() => undefined}
                    onClear={() => void write(() => clearReadinessItemState(item.id))}
                  />
                ))}
              </ul>
            </details>
          </section>
        )}
      </div>
    </SectionCard>
  );
}

const rowStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--ts-space-sm)",
  padding: "var(--ts-space-md)",
  background: "var(--ts-tile)",
  borderRadius: "var(--ts-radius-card)",
} as const;

interface ItemRowProps {
  item: ReadinessItem;
  group: ReadinessGroupId | "parked";
  isAdmin: boolean;
  demo: boolean;
  minHeight: number;
  href: string | null;
  onSnooze: () => void;
  onOptOut: () => void;
  onClear: () => void;
}

function ItemRow({
  item,
  group,
  isAdmin,
  demo,
  minHeight,
  href,
  onSnooze,
  onOptOut,
  onClear,
}: ItemRowProps): JSX.Element {
  const { t } = useTranslation(["readiness"]);
  const checked = profileDateTime(item.checkedAt);
  const unknown = item.status === "unknown";
  const active = group !== "ready" && group !== "parked";
  return (
    <li data-item={item.id} data-group={group} style={rowStyle}>
      <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
        <strong>{t(readinessKey(item.titleKey))}</strong>
        {unknown && (
          <Pill color={token("muted")} dashed>
            {t("readiness:unchecked")}
          </Pill>
        )}
        {isAdmin && item.scope === "admin" && (
          <Pill color={token("muted")}>{t("readiness:scope.server")}</Pill>
        )}
      </div>
      <p className="t-caption">{t(readinessKey(item.consequenceKey))}</p>
      {unknown && !checked && <p className="t-caption">{t("readiness:neverChecked")}</p>}
      {checked && <p className="t-caption">{t("readiness:checkedAt", { time: checked })}</p>}
      {group === "blocked" && !href && <p className="t-caption">{t("readiness:blockedHint")}</p>}
      <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
        {href && (
          <Link
            to={href}
            className="underline"
            style={{
              minHeight,
              display: "inline-flex",
              alignItems: "center",
              color: "var(--ts-accent-text)",
            }}
          >
            {unknown ? t("readiness:checkNow") : t("readiness:openAction")}
          </Link>
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
    </li>
  );
}
