import { useId, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { railApi } from "../../lib/api/rail";
import { logger } from "../../lib/logger";
import { formatRailDuration } from "../../lib/rail/railDuration";
import type { RailTransfer } from "../../lib/rail/railTransfer";

interface Props {
  transfer: RailTransfer;
  /** The leg arriving at the change — it carries the user's "tight" mark. */
  arriving: { id: string; arrStationName: string; tightConnection: boolean };
  /** The leg leaving after it. */
  departing: { depStationName: string };
  /** Index of the gap, for test ids: the gap before leg `index`. */
  index: number;
}

/**
 * The line between two legs (forgejo#234): how long the change is, that the
 * next train leaves before this one arrives, that the change means walking to
 * another station — or that the wait cannot be told. It claims no change will
 * WORK: the automatic "under ten minutes" is worded as a hint, and "knapp" is
 * the user's own mark, saved on the arriving leg.
 */
export function RailTransferNote({ transfer, arriving, departing, index }: Props): JSX.Element {
  const { t } = useTranslation(["rail"]);

  if (transfer.kind === "separate") {
    return (
      <li className="t-caption border-t border-border pt-2" data-testid={`rail-transfer-${index}`}>
        {t("rail:transfer.separate")}
      </li>
    );
  }

  const station = arriving.arrStationName;
  const headline =
    transfer.kind === "transfer"
      ? t("rail:transfer.wait", { station, wait: formatRailDuration(transfer.minutes, t) })
      : transfer.kind === "conflict"
        ? t("rail:transfer.conflict", { wait: formatRailDuration(-transfer.minutes, t) })
        : t("rail:transfer.unknown", { station });

  return (
    <li
      className="rounded-md border border-border px-3 py-2 text-sm"
      data-testid={`rail-transfer-${index}`}
      data-kind={transfer.kind}
    >
      <p className={transfer.kind === "conflict" ? "font-medium text-(--danger)" : undefined}>
        {headline}
      </p>
      {transfer.stationChange && (
        <p className="t-caption" data-testid={`rail-transfer-${index}-station-change`}>
          {t("rail:transfer.stationChange", { from: station, to: departing.depStationName })}
        </p>
      )}
      {transfer.kind === "unknown" && <p className="t-caption">{t("rail:transfer.unknownWhy")}</p>}
      {transfer.kind === "transfer" && transfer.shortHint && (
        <p className="t-caption" data-testid={`rail-transfer-${index}-hint`}>
          {t("rail:transfer.shortHint")}
        </p>
      )}
      <TightMark legId={arriving.id} stored={arriving.tightConnection} />
    </li>
  );
}

/**
 * The "knapp" checkbox. Not optimistic: the box shows what is STORED, so a
 * refused save leaves it as it was and says so beside it — a mark that only
 * looked saved would be the silent success this project keeps removing.
 */
function TightMark({ legId, stored }: { legId: string; stored: boolean }): JSX.Element {
  const { t } = useTranslation(["rail"]);
  const id = useId();
  const [marked, setMarked] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = async (next: boolean): Promise<void> => {
    setSaving(true);
    setFailed(false);
    try {
      const { journey } = await railApi.update(legId, { tightConnection: next });
      setMarked(journey.tightConnection);
    } catch (err: unknown) {
      logger.error("RailTransferNote: tight mark not saved", err);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-1">
      <label
        htmlFor={id}
        className="inline-flex items-center gap-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
      >
        <input
          id={id}
          type="checkbox"
          checked={marked}
          disabled={saving}
          aria-describedby={failed ? `${id}-error` : undefined}
          onChange={(e): void => void toggle(e.target.checked)}
        />
        {t("rail:transfer.markTight")}
      </label>
      {failed && (
        <p id={`${id}-error`} role="alert" className="text-xs text-(--danger)">
          {t("rail:transfer.markFailed")}
        </p>
      )}
    </div>
  );
}
