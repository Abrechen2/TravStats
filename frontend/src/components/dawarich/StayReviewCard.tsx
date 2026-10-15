import { useState } from "react";
import { Link } from "react-router-dom";
import { dawarichStaysApi, type DawarichStay, type StayChoices } from "../../lib/api/dawarichStays";
import { toLocal } from "../../shared/time/zone";
import { useTranslation } from "../../hooks/useTranslation";
import { apiErrorMachineCode } from "../../lib/apiError";
import { Card } from "../ui/Card";

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
  const [name, setName] = useState(row.name ?? "");
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
    try {
      if (accept)
        await dawarichStaysApi.accept(row.id, {
          name,
          placeId: placeId || null,
          tripId: tripId || null,
          lat: Number(lat),
          lon: Number(lon),
          startAt: { local: start },
          endAt: { local: end },
        });
      else await dawarichStaysApi.reject(row.id);
      onDone();
    } catch (e) {
      const code = apiErrorMachineCode(e);
      setError(
        text(
          code === "DAWARICH_VISIT_TRIP_CONFLICT"
            ? "tripConflict"
            : code === "DAWARICH_INVALID_INTERVAL"
              ? "invalidInterval"
              : code === "TIME_AMBIGUOUS" || code === "LOCAL_TIME_NONEXISTENT"
                ? "ambiguousTime"
                : "error"
        )
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
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
      <ul className="list-disc pl-5 my-3">
        {row.evidence.uncertainties.map((reason) => (
          <li key={reason}>{text(`uncertainty.${reason}`)}</li>
        ))}
      </ul>
      {row.status === "pending" && row.evidence.matchingVisitId && <p>{text("existingVisit")}</p>}
      <details>
        <summary>{text("provenance")}</summary>
        <p className="break-all">Dawarich · {row.id}</p>
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
        <p className="break-all">
          {text("points")}: {row.evidence.pointIds.join(", ")}
        </p>
      </details>
      {row.status === "pending" ? (
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
              onChange={(e) => setName(e.target.value)}
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
