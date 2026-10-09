import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import Modal from "../Modal";
import Button from "../ui/Button";
import IconButton from "../ui/IconButton";
import { Icon } from "../ui/Icon";
import { Field, Input } from "../ui/Field";
import { SaveBlockedHint } from "../form";
import type { MissingStep } from "../form";
import { useTranslation } from "../../hooks/useTranslation";
import { roadtripsApi } from "../../lib/api/roadtrips";
import { tripsApi } from "../../lib/api/trips";
import { useDisplayFormat } from "../../lib/displayFormat";
import { stayCheckIn, stayCheckOut } from "../../lib/entityTimes";
import { logger } from "../../lib/logger";
import { dayKey } from "../../lib/roadtrip/roadtripView";
import type { EditorStation } from "../../lib/roadtrip/editorStation";
import {
  shiftPreview,
  type ShiftNotice,
  type ShiftRow,
  type SpanRef,
  type StayRef,
} from "../../lib/roadtrip/shiftDays";
import type { Lodging } from "../../types/lodging";

const DAYS_ID = "roadtrip-shift-days";
const HINT_ID = "roadtrip-shift-blocked";

/** Every stay of the lodging library, as the shift checks it: exact days only. */
export function stayRefs(lodgings: readonly Lodging[] | null): StayRef[] {
  return (lodgings ?? []).flatMap((lodging) =>
    (lodging.stays ?? []).map((stay) => {
      const exact = stay.datePrecision === "DAY";
      return {
        id: stay.id,
        lodgingId: lodging.id,
        label: lodging.name,
        checkIn: exact ? (stayCheckIn(stay)?.date ?? null) : null,
        checkOut: exact ? (stayCheckOut(stay)?.date ?? null) : null,
        cancelled: stay.status === "cancelled",
      };
    })
  );
}

/**
 * "Ab hier verschieben" (forgejo#241): every following station moves by the
 * same number of days. Nothing moves before the reader has seen each old and
 * new date and every reason to look twice; linked stays keep their dates and
 * are listed to check, with a link that opens beside the editor. Applying is
 * one step the editor's undo bar can take back.
 */
export default function ShiftDaysDialog({
  routeId,
  tripId,
  drafts,
  fromIndex,
  lodgings,
  onApply,
  onClose,
}: {
  routeId: string;
  tripId: string | null;
  drafts: readonly EditorStation[];
  fromIndex: number;
  lodgings: readonly Lodging[] | null;
  onApply: (shifted: EditorStation[], rows: ShiftRow[], days: number) => void;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips", "common"]);
  const display = useDisplayFormat();
  const [daysText, setDaysText] = useState("1");
  const [trips, setTrips] = useState<SpanRef[]>([]);
  const [roadtrips, setRoadtrips] = useState<SpanRef[]>([]);
  const [contextFailed, setContextFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([tripsApi.getAll(), roadtripsApi.list()])
      .then(([tripRows, roadtripRows]) => {
        if (cancelled) return;
        setTrips(
          tripRows.map((r) => ({
            id: r.id,
            name: r.name,
            start: dayKey(r.startDate),
            end: dayKey(r.endDate),
          }))
        );
        setRoadtrips(
          roadtripRows
            .filter((r) => r.id !== routeId)
            .map((r) => ({
              id: r.id,
              name: r.name,
              start: dayKey(r.startDate),
              end: dayKey(r.endDate),
            }))
        );
      })
      // Checked against nothing is not checked: said, never a silent "fine".
      .catch((err: unknown) => {
        logger.warn("Loading trips for a day shift failed", err);
        if (!cancelled) setContextFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  const days = /^-?\d{1,3}$/.test(daysText.trim()) ? Number(daysText.trim()) : null;
  const stays = useMemo(() => stayRefs(lodgings), [lodgings]);
  const preview = useMemo(
    () =>
      shiftPreview(drafts, fromIndex, days ?? 0, {
        stays,
        ownTrip: trips.find((trip) => trip.id === tripId) ?? null,
        trips,
        roadtrips,
      }),
    [drafts, fromIndex, days, stays, trips, roadtrips, tripId]
  );

  const name = (s: EditorStation): string =>
    s.title.trim() ||
    (s.night.kind === "via" ? t("roadtrips:night.via") : t("roadtrips:editor.unnamed"));
  const short = (value: string | null): string =>
    value ? display.date(`${value}T00:00:00Z`, { timeZone: "UTC", omitYear: true }) : "—";
  const span = (from: string | null, to: string | null): string =>
    to && to !== from ? `${short(from)} – ${short(to)}` : short(from);

  const missing: MissingStep[] =
    days === null || days === 0
      ? [{ field: DAYS_ID, label: t("roadtrips:shift.missingDays") }]
      : preview.rows.length === 0
        ? [{ field: DAYS_ID, label: t("roadtrips:shift.missingDated") }]
        : [];

  const step = (delta: number): void => setDaysText(String((days ?? 0) + delta));

  const notice = (n: ShiftNotice, index: number): JSX.Element => {
    switch (n.kind) {
      case "beforePrevious":
        return (
          <li key={index} style={{ color: "var(--ts-warn)" }}>
            {t("roadtrips:shift.notice.beforePrevious", {
              name: name(n.station),
              previous: name(n.previous),
            })}
          </li>
        );
      case "gap":
        return (
          <li key={index}>
            {t("roadtrips:shift.notice.gap", {
              count: n.days,
              name: name(n.station),
              previous: name(n.previous),
            })}
          </li>
        );
      case "linkedStay":
        return (
          <li key={index} style={{ color: n.fits ? undefined : "var(--ts-warn)" }}>
            {t("roadtrips:shift.notice.linkedStay", {
              name: n.stay?.label ?? name(n.station),
              dates: n.stay ? span(n.stay.checkIn, n.stay.checkOut) : "—",
            })}{" "}
            {n.stay && (
              <Link
                to={`/lodging/${n.stay.lodgingId}`}
                target="_blank"
                rel="noopener"
                className="underline"
              >
                {t("roadtrips:shift.check")}
              </Link>
            )}
          </li>
        );
      case "otherStay":
        return (
          <li key={index} style={{ color: "var(--ts-warn)" }}>
            {t("roadtrips:shift.notice.otherStay", {
              name: name(n.station),
              stay: n.stay.label,
              dates: span(n.stay.checkIn, n.stay.checkOut),
            })}
          </li>
        );
      case "outsideTrip":
        return (
          <li key={index} style={{ color: "var(--ts-warn)" }}>
            {t("roadtrips:shift.notice.outsideTrip", {
              trip: n.trip.name,
              dates: span(n.trip.start, n.trip.end),
            })}
          </li>
        );
      case "overlapsTrip":
        return (
          <li key={index} style={{ color: "var(--ts-warn)" }}>
            {t("roadtrips:shift.notice.overlapsTrip", {
              trip: n.trip.name,
              dates: span(n.trip.start, n.trip.end),
            })}
          </li>
        );
      case "overlapsRoadtrip":
        return (
          <li key={index} style={{ color: "var(--ts-warn)" }}>
            {t("roadtrips:shift.notice.overlapsRoadtrip", {
              roadtrip: n.roadtrip.name,
              dates: span(n.roadtrip.start, n.roadtrip.end),
            })}
          </li>
        );
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth={640}
      closeLabel={t("common:buttons.close")}
      title={t("roadtrips:shift.title", { name: name(drafts[fromIndex]) })}
      footer={
        <>
          <div className="mr-auto self-center">
            <SaveBlockedHint id={HINT_ID} missing={missing} />
          </div>
          <Button variant="secondary" onClick={onClose}>
            {t("common:buttons.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={missing.length > 0}
            aria-describedby={HINT_ID}
            onClick={() => onApply(preview.shifted, preview.rows, days ?? 0)}
          >
            {t("roadtrips:shift.apply")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col" style={{ gap: 16 }}>
        <p className="t-caption">{t("roadtrips:shift.intro")}</p>
        <div className="flex items-end" style={{ gap: 8 }}>
          <IconButton label={t("roadtrips:shift.earlier")} onClick={() => step(-1)}>
            <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>
              −
            </span>
          </IconButton>
          <div style={{ width: 140 }}>
            <Field
              label={t("roadtrips:shift.days")}
              htmlFor={DAYS_ID}
              error={days === null ? t("roadtrips:shift.daysInvalid") : undefined}
            >
              <Input
                id={DAYS_ID}
                inputMode="numeric"
                value={daysText}
                onChange={(e) => setDaysText(e.target.value)}
                style={{ fontFamily: "var(--ts-font-mono)" }}
              />
            </Field>
          </div>
          <IconButton label={t("roadtrips:shift.later")} onClick={() => step(1)}>
            <Icon name="plus" size={16} />
          </IconButton>
        </div>
        <p className="t-caption">{t("roadtrips:shift.daysHint")}</p>

        {preview.rows.length > 0 && (
          <table className="w-full text-sm" data-testid="shift-preview">
            <thead>
              <tr className="text-left">
                <th className="t-label-mono">{t("roadtrips:shift.colStation")}</th>
                <th className="t-label-mono">{t("roadtrips:shift.colBefore")}</th>
                <th className="t-label-mono">{t("roadtrips:shift.colAfter")}</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={row.station.key}>
                  <td style={{ fontWeight: 700, padding: "4px 8px 4px 0" }}>{name(row.station)}</td>
                  <td style={{ padding: "4px 8px 4px 0" }}>
                    {span(row.before.start, row.before.end)}
                  </td>
                  <td style={{ padding: "4px 0" }}>{span(row.after.start, row.after.end)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {(preview.notices.length > 0 || contextFailed) && (
          <section className="flex flex-col" style={{ gap: 6 }} data-testid="shift-notices">
            <h3 className="t-label-mono">{t("roadtrips:shift.noticesTitle")}</h3>
            <ul className="flex flex-col" style={{ gap: 6, paddingLeft: 18, fontSize: 13 }}>
              {preview.notices.map(notice)}
              {contextFailed && (
                <li style={{ color: "var(--ts-warn)" }}>{t("roadtrips:shift.contextFailed")}</li>
              )}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  );
}
