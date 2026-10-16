import { useEffect, useState } from "react";
import { Button, Chip, Dialog, Field, Select } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useSettingsStore } from "../../store/settingsStore";
import { DOMAINS, type DomainKey } from "../../shared/domains";
import { LEADERBOARD_METRICS, METRIC_GROUPS } from "../../shared/comparisonMetrics";
import { comparisonApi, comparisonFailureCode } from "../../lib/api/comparison";
import type { LeaderboardScope, LeaderboardSnapshot } from "../../lib/comparison/types";
import { formatMetricOrAbsent } from "../../lib/comparison/formatMetric";
import { recentYears } from "../../lib/comparison/years";
import { logger } from "../../lib/logger";

/**
 * One preview call per burst of chip toggles, not per toggle: /preview shares the 60/min read
 * bucket with /leaderboard, and a user clicking through the chips would otherwise throttle both.
 */
const PREVIEW_DEBOUNCE_MS = 300;

/**
 * Why the dialog is open, which decides the one sentence about the other side: a new question
 * ("ask") shares nothing until they agree; answering their request ("accept") starts the exchange
 * at once, because their yes came with the request; "change" edits a share that already exists.
 */
export type ConsentMode = "ask" | "accept" | "change";

export interface ConsentDialogProps {
  open: boolean;
  mode: ConsentMode;
  onClose: () => void;
  /** Who will see the numbers; `origin` is set for a person on another server. */
  person: { displayName: string; origin: string | null };
  initialScope?: LeaderboardScope | null;
  onConfirm: (scope: LeaderboardScope) => Promise<void>;
}

const toggle = <T,>(list: readonly T[], item: T): T[] =>
  list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

const gap = (size: string) => ({ gap: `var(--ts-space-${size})` });

/**
 * The one consent question of the comparison (spec 11.2): who, which figures, which period,
 * and the actual numbers that answer would share, from the server, under exactly that scope.
 * Chips rather than switches: nothing takes effect until "Teilen".
 */
export default function ConsentDialog({
  open,
  mode,
  onClose,
  person,
  initialScope,
  onConfirm,
}: ConsentDialogProps): JSX.Element {
  const { t, i18n } = useTranslation(["comparison", "common", "stats"]);
  const { enabled } = useEnabledDomains();
  const distanceUnit = useSettingsStore((s) => s.units.distanceUnit);
  const zone = useSettingsStore((s) => s.display.timezone);
  // A domain without a chip can never be unticked, so it must never be sent.
  const startScope = (): LeaderboardScope =>
    initialScope
      ? { ...initialScope, domains: initialScope.domains.filter((d) => enabled.includes(d)) }
      : { groups: [...METRIC_GROUPS], domains: [...enabled], year: null };
  const [scope, setScope] = useState<LeaderboardScope>(startScope);
  const [wasOpen, setWasOpen] = useState(open);
  // The component outlives a closed dialog; reopening starts the question afresh.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setScope(startScope());
  }
  // The numbers carry the scope they answer: while they belong to an older one they are
  // not what "Teilen" would share, so they are neither shown nor confirmable.
  const [preview, setPreview] = useState<{ key: string; snapshot: LeaderboardSnapshot } | null>(
    null
  );
  const scopeKey = JSON.stringify(scope);
  const current = preview?.key === scopeKey ? preview.snapshot : null;
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = scope.groups.length > 0 && scope.domains.length > 0;
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));

  useEffect(() => {
    if (!open || !valid) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let alive = true;
    setPreviewError(null);
    const timer = setTimeout(() => {
      comparisonApi.preview(scope).then(
        (snapshot) => {
          if (alive) setPreview({ key: scopeKey, snapshot });
        },
        (failure: unknown) => {
          logger.debug("comparison preview failed", failure);
          if (!alive) return;
          setPreview(null);
          // A throttled preview is not a broken one: the user only has to wait.
          setPreviewError(
            comparisonFailureCode(failure) === "rateLimited"
              ? tr("error.rateLimited")
              : tr("consent.previewFailed")
          );
        }
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, scope, scopeKey, valid]);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(scope);
    } catch (failure) {
      setError(tr(`error.${comparisonFailureCode(failure)}`));
    } finally {
      setBusy(false);
    }
  };

  const shown = current
    ? LEADERBOARD_METRICS.filter((m) =>
        Object.prototype.hasOwnProperty.call(current.metrics, m.key)
      )
    : [];
  const recent = recentYears(zone);
  const years =
    scope.year !== null && !recent.includes(scope.year)
      ? [...recent, scope.year].sort((a, b) => b - a)
      : recent;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={tr("consent.title", { name: person.displayName })}
      dismissLabel={tr("common:buttons.cancel")}
      action={
        <Button disabled={!valid || busy || !current} onClick={() => void confirm()}>
          {tr("consent.share")}
        </Button>
      }
    >
      <div className="flex flex-col" style={gap("lg")}>
        <div
          role="group"
          aria-label={tr("group.label")}
          className="flex flex-wrap"
          style={gap("xs")}
        >
          {METRIC_GROUPS.map((g) => (
            <Chip
              key={g}
              active={scope.groups.includes(g)}
              onClick={() => setScope((s) => ({ ...s, groups: toggle(s.groups, g) }))}
            >
              {tr(`group.${g}`)}
            </Chip>
          ))}
        </div>
        <div
          role="group"
          aria-label={tr("consent.domains")}
          className="flex flex-wrap"
          style={gap("xs")}
        >
          {enabled.map((d: DomainKey) => (
            <Chip
              key={d}
              active={scope.domains.includes(d)}
              onClick={() => setScope((s) => ({ ...s, domains: toggle(s.domains, d) }))}
            >
              {tr(`common:${DOMAINS[d].i18nKey}`)}
            </Chip>
          ))}
        </div>
        <Field label={tr("consent.period")} htmlFor="consent-period">
          <Select
            id="consent-period"
            value={scope.year === null ? "all" : String(scope.year)}
            onChange={(e) =>
              setScope((s) => ({
                ...s,
                year: e.target.value === "all" ? null : Number(e.target.value),
              }))
            }
          >
            <option value="all">{tr("consent.allYears")}</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {tr("consent.onlyYear", { year: y })}
              </option>
            ))}
          </Select>
        </Field>
        {!valid && <p className="t-caption">{tr("consent.nothingChosen")}</p>}
        {valid && current && (
          <dl aria-label={tr("consent.preview")} className="grid grid-cols-2" style={gap("xs")}>
            {shown.map((m) => (
              <div key={m.key} className="contents">
                <dt className="t-caption">{tr(`metric.${m.key}`)}</dt>
                <dd>
                  {formatMetricOrAbsent(current.metrics[m.key], m.unit, {
                    distanceUnit,
                    t: tr,
                    language: i18n.language,
                  })}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {previewError && <p role="alert">{previewError}</p>}
        <p className="t-caption">{tr("consent.finePrint")}</p>
        {mode !== "change" && (
          <p className="t-caption">
            {tr(mode === "ask" ? "consent.pendingNotice" : "consent.acceptNotice", {
              name: person.displayName,
            })}
          </p>
        )}
        {person.origin && (
          <p className="t-caption" role="note">
            {tr("consent.remoteNotice", { origin: person.origin })}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
