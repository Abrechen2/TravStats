import { useState } from "react";
import { Link } from "react-router-dom";
import { dawarichStaysApi, type DawarichStay, type StayChoices } from "../../lib/api/dawarichStays";
import { toLocal } from "../../shared/time/zone";
import { useTranslation } from "../../hooks/useTranslation";
import { apiErrorMachineCode } from "../../lib/apiError";
import { Card } from "../ui/Card";
import StayIdentityPanel from "./StayIdentityPanel";

/**
 * How often an accept is asked again when the server says "try again" — it is
 * being published elsewhere, or the history moved under it — and how far apart.
 */
const RETRYABLE = new Set(["SUGGESTION_ACCEPT_IN_PROGRESS", "HISTORY_CHANGED"]);
const IN_PROGRESS_RETRIES = 4;
const IN_PROGRESS_DELAY_MS = 1500;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function StayReviewCard({
  row,
  choices,
  onDone,
}: {
  row: DawarichStay;
  choices: StayChoices;
  onDone: () => void;
}): JSX.Element {
  const { t } = useTranslation("trips");
  const text = (key: string) => t(`trips:dawarichStays.${key}`);
  // A TravTrack finding (plan E4) names its source and explains itself; a
  // Dawarich one reads exactly as it always did.
  const travtrack = row.evidence.source === "travtrack";
  // Mid-accept is still a question: a claim a crash left is taken over.
  const open = row.status === "pending" || row.status === "accepting";
  const [name, setName] = useState(row.name ?? "");
  // Set once the user types or picks; a late identity answer never overwrites them.
  const [nameTouched, setNameTouched] = useState(false);
  const pickName = (picked: string) => {
    setNameTouched(true);
    setName(picked);
  };
  const [placeId, setPlaceId] = useState(row.placeId ?? "");
  const [tripId, setTripId] = useState(row.tripId ?? "");
  const [lat, setLat] = useState(String(row.lat));
  const [lon, setLon] = useState(String(row.lon));
  const [start, setStart] = useState(
    (row.times?.startAt?.local ?? toLocal(row.startAt, row.zone).local).slice(0, 16)
  );
  const [end, setEnd] = useState(
    (row.times?.endAt?.local ?? toLocal(row.endAt, row.zone).local).slice(0, 16)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (accept: boolean) => {
    setBusy(true);
    setError(null);
    const review = {
      name,
      placeId: placeId || null,
      tripId: tripId || null,
      lat: Number(lat),
      lon: Number(lon),
      startAt: { local: start },
      endAt: { local: end },
    };
    try {
      if (accept) {
        // Another tab or device is publishing this very accept (the answer will
        // be its visit, the replay), or the history moved under it: ask again quietly.
        for (let attempt = 0; ; attempt++) {
          try {
            await dawarichStaysApi.accept(row.id, review);
            break;
          } catch (e) {
            if (!RETRYABLE.has(apiErrorMachineCode(e) ?? "") || attempt >= IN_PROGRESS_RETRIES)
              throw e;
            await pause(IN_PROGRESS_DELAY_MS);
          }
        }
      } else await dawarichStaysApi.reject(row.id);
      onDone();
    } catch (e) {
      // A TravTrack finding that went with deleted history before the accept
      // reached it answers the stays route's code-less 404 (a missing row names
      // no provider). On a TravTrack card that 404 means the same as
      // SUGGESTION_NOT_FOUND; a Dawarich card reads it as before.
      const status = (e as { response?: { status?: number } } | undefined)?.response?.status;
      const code =
        apiErrorMachineCode(e) ?? (travtrack && status === 404 ? "SUGGESTION_NOT_FOUND" : null);
      setError(
        text(
          code === "DAWARICH_VISIT_TRIP_CONFLICT"
            ? "tripConflict"
            : code === "DAWARICH_INVALID_INTERVAL"
              ? "invalidInterval"
              : code === "TIME_AMBIGUOUS" || code === "LOCAL_TIME_NONEXISTENT"
                ? "ambiguousTime"
                : code === "EVIDENCE_INVALIDATED"
                  ? "evidenceInvalidated"
                  : code === "SUGGESTION_NOT_FOUND"
                    ? "suggestionGone"
                    : code === "EVIDENCE_UNVERIFIABLE"
                      ? "evidenceUnverifiable"
                      : code === "TRAVTRACK_DISABLED"
                        ? "travTrackDisabled"
                        : code === "SUGGESTION_ACCEPT_IN_PROGRESS"
                          ? "acceptInProgress"
                          : code === "HISTORY_CHANGED"
                            ? "historyChanged"
                            : "error"
        )
      );
      // The history behind it is gone: the finding is no longer a question.
      if (code === "EVIDENCE_INVALIDATED" || code === "SUGGESTION_NOT_FOUND") onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      {travtrack && <p className="t-caption">{text("source.travtrack")}</p>}
      {travtrack && row.beforeSourceSwitch && (
        <p className="t-caption">{text("beforeSourceSwitch")}</p>
      )}
      {row.evidence.kind === "market" && <p className="t-caption">{text("markets.venue")}</p>}
      {row.evidence.kind === "venue" && (
        <p className="t-caption">
          {text(`venues.types.${row.evidence.market?.venueType ?? "unknown"}`)}
        </p>
      )}
      <h3 className="t-heading-sm">{row.name || text("unnamed")}</h3>
      <p className="t-body">
        {(
          row.times?.sourceStartAt?.local ?? toLocal(row.sourceStartAt, row.evidence.zone).local
        ).replace("T", " ")}{" "}
        –{" "}
        {(
          row.times?.sourceEndAt?.local ?? toLocal(row.sourceEndAt, row.evidence.zone).local
        ).replace("T", " ")}{" "}
        ({row.evidence.zone})
      </p>
      <p className="t-caption">
        {t("trips:dawarichStays.evidence", {
          count: row.pointCount,
          gap: row.evidence.maxGapMinutes,
        })}{" "}
        · {row.sourceLat.toFixed(5)}, {row.sourceLon.toFixed(5)}
      </p>
      {travtrack && row.evidence.explanation && (
        <p className="t-caption">
          {t(
            `trips:dawarichStays.explanation.${row.evidence.explanation.code}`,
            row.evidence.explanation.params
          )}
        </p>
      )}
      <StayIdentityPanel
        stayId={row.id}
        lat={row.lat}
        lon={row.lon}
        onPickName={open && !placeId && !busy ? pickName : undefined}
        onIdentity={(identity) => {
          // Prefill an empty, untouched name with a specific place — an address
          // or a nearby place, never just the photos' city. It sits in the field,
          // visible and editable, until the user accepts.
          const probable = identity.probable;
          if (!open || nameTouched || placeId || name) return;
          if (probable && probable.source !== "photos") setName(probable.name);
        }}
      />
      <ul className="list-disc pl-5 my-3">
        {row.evidence.uncertainties.map((reason) => (
          <li key={reason}>{text(`uncertainty.${reason}`)}</li>
        ))}
      </ul>
      {open && row.evidence.matchingVisitId && <p>{text("existingVisit")}</p>}
      <details>
        <summary>{text("provenance")}</summary>
        <p className="break-all">
          {travtrack ? "TravTrack" : "Dawarich"} · {row.id}
        </p>
        {row.evidence.market && (
          <div>
            <p>
              {t(
                `trips:dawarichStays.${row.evidence.kind === "venue" ? "venues" : "markets"}.interior`,
                {
                  count: row.evidence.market.interiorPointCount,
                }
              )}
            </p>
            <ul>
              {row.evidence.market.sourceUrls
                .filter((url) =>
                  /^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/.test(url)
                )
                .map((url) => (
                  <li key={url}>
                    <a className="underline" href={url} target="_blank" rel="noopener noreferrer">
                      {text(row.evidence.kind === "venue" ? "venues.source" : "markets.source")}
                    </a>
                  </li>
                ))}
            </ul>
          </div>
        )}
        <p>
          {text("detected")}: {row.detectedAt}
        </p>
        {row.resolvedAt && (
          <p>
            {text("resolved")}: {row.resolvedAt}
          </p>
        )}
        {row.evidence.pointIds && (
          <p className="break-all">
            {text("points")}: {row.evidence.pointIds.join(", ")}
          </p>
        )}
      </details>
      {open ? (
        <form
          className="grid gap-3 mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(true);
          }}
        >
          <label>
            {text("place")}
            <select
              className="input"
              value={placeId}
              disabled={busy}
              onChange={(e) => {
                setPlaceId(e.target.value);
                const p = choices.places.find((p) => p.id === e.target.value);
                if (p) {
                  setName(p.name);
                  setLat(String(p.lat));
                  setLon(String(p.lon));
                }
              }}
            >
              <option value="">{text("newPlace")}</option>
              {choices.places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {text("name")}
            <input
              className="input"
              required
              maxLength={200}
              value={name}
              disabled={busy || !!placeId}
              onChange={(e) => pickName(e.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              {text("latitude")}
              <input
                className="input"
                type="number"
                min={-90}
                max={90}
                step="any"
                required
                disabled={busy || !!placeId}
                value={lat}
                onChange={(e) => setLat(e.target.value)}
              />
            </label>
            <label>
              {text("longitude")}
              <input
                className="input"
                type="number"
                min={-180}
                max={180}
                step="any"
                required
                disabled={busy || !!placeId}
                value={lon}
                onChange={(e) => setLon(e.target.value)}
              />
            </label>
          </div>
          <p className="t-caption">{text("localTime")}</p>
          <label>
            {text("start")}
            <input
              className="input"
              type="datetime-local"
              required
              value={start}
              disabled={busy}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            {text("end")}
            <input
              className="input"
              type="datetime-local"
              required
              value={end}
              disabled={busy}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <label>
            {text("trip")}
            <select
              className="input"
              value={tripId}
              disabled={busy}
              onChange={(e) => setTripId(e.target.value)}
            >
              <option value="">{text("noTrip")}</option>
              {choices.trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-3">
            <button className="btn-primary" disabled={busy} type="submit">
              {text("accept")}
            </button>
            <button
              className="btn-secondary"
              disabled={busy}
              type="button"
              onClick={() => void submit(false)}
            >
              {text("reject")}
            </button>
          </div>
        </form>
      ) : (
        <p className="mt-3">
          {text(`status.${row.status}`)} ·{" "}
          {(row.times?.startAt?.local ?? toLocal(row.startAt, row.zone).local).replace("T", " ")} –{" "}
          {(row.times?.endAt?.local ?? toLocal(row.endAt, row.zone).local).replace("T", " ")} (
          {row.zone})
          {row.visit && (
            <>
              {" "}
              ·{" "}
              <Link className="underline" to={`/places/${row.visit.placeId}`}>
                {text("openVisit")}
              </Link>
            </>
          )}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </Card>
  );
}
