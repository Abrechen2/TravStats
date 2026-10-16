import { useState } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { flightsApi } from "../../../lib/api/flights";
import { tripsApi } from "../../../lib/api/trips";
import type { DataQualityFlag } from "../../../types/dataQuality";
import Button from "../../ui/Button";
import { W } from "./model";

import RecordEditButton from "./RecordEditButton";
/**
 * Runs one answer: the operation, an optional re-check, a reload — and, when
 * given, a confirmation of what was done (the old per-tab toasts said so; a
 * card that just vanishes leaves the reader guessing whether it saved).
 */
export type InboxAction = (
  operation: () => Promise<unknown>,
  recheck?: boolean,
  done?: string
) => Promise<boolean>;

function TripDates({
  flag,
  busy,
  act,
}: {
  flag: Extract<DataQualityFlag, { kind: "trip_end_missing" | "trip_entries_outside" }>;
  busy: boolean;
  act: InboxAction;
}) {
  const { t } = useTranslation(["dataQuality"]);
  const [start, setStart] = useState(flag.details.startDay);
  const [end, setEnd] = useState(
    flag.kind === "trip_entries_outside" ? flag.details.endDay : (flag.details.lastEntryDay ?? "")
  );
  const valid = Boolean(start && end && end >= start);
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy)
          void act(() => tripsApi.update(flag.entityId, { startDate: start, endDate: end }), true);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          {t(`${W}.start`)}
          <input
            required
            type="date"
            className="input mt-1 w-full"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="text-sm">
          {t(`${W}.end`)}
          <input
            required
            type="date"
            className="input mt-1 w-full"
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      {!valid && <p className="t-caption">{t(`${W}.invalidDates`)}</p>}
      <p className="t-caption">{t(`${W}.tripEffect`)}</p>
      <Button type="submit" variant="primary" disabled={busy || !valid}>
        {t(`${W}.saveDates`)}
      </Button>
    </form>
  );
}

function FlightNumber({
  flag,
  busy,
  act,
}: {
  flag: DataQualityFlag;
  busy: boolean;
  act: InboxAction;
}) {
  const { t } = useTranslation(["dataQuality"]);
  const [number, setNumber] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (number.trim() && !busy)
          void act(
            () => flightsApi.update(flag.entityId, { flightNumber: number.trim().toUpperCase() }),
            true
          );
      }}
    >
      <label className="block text-sm">
        {t(`${W}.flightNumber`)}
        <input
          required
          className="input mt-1 w-full"
          maxLength={20}
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
      </label>
      <p className="t-caption">{t(`${W}.numberEffect`)}</p>
      <Button type="submit" variant="primary" disabled={busy || !number.trim()}>
        {t(`${W}.saveNumber`)}
      </Button>
    </form>
  );
}

export default function FlagQuickEditor({
  flag,
  busy,
  act,
}: {
  flag: DataQualityFlag;
  busy: boolean;
  act: InboxAction;
}) {
  const { t } = useTranslation(["dataQuality", "common"]);
  return (
    <div className="space-y-3">
      {(flag.kind === "trip_end_missing" || flag.kind === "trip_entries_outside") && (
        <TripDates flag={flag} busy={busy} act={act} />
      )}
      {flag.kind === "flight_number_missing" && <FlightNumber flag={flag} busy={busy} act={act} />}
      <RecordEditButton
        entityType={flag.entityType}
        entityId={flag.entityId}
        parentId={flag.subject && "parentId" in flag.subject ? flag.subject.parentId : null}
        disabled={busy}
        onSaved={() => void act(async () => {}, true)}
      />
      {flag.kind === "stay_dates_reversed" &&
        flag.details.stays.map((stay) => (
          <RecordEditButton
            key={stay.stayId}
            entityType="lodging_stay"
            entityId={stay.stayId}
            parentId={flag.entityId}
            label={t(`${W}.stay`)}
            disabled={busy}
            onSaved={() => void act(async () => {}, true)}
          />
        ))}
      {(flag.kind === "chronology_conflict"
        ? [flag.details.conflictWith]
        : flag.kind === "duplicate_candidate"
          ? flag.details.copies
          : flag.kind === "trip_entries_outside"
            ? flag.details.entries
            : []
      ).map((record) => (
        <RecordEditButton
          key={`${record.entityType}:${record.entityId}`}
          {...record}
          disabled={busy}
          label={record.label}
          onSaved={() => void act(async () => {}, true)}
        />
      ))}
    </div>
  );
}
