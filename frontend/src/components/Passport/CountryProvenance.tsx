import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { statsApi } from "../../lib/api";
import { classifyLoadFailure, type LoadFailure } from "../../lib/api/loadFailure";
import { logger } from "../../lib/logger";
import type { CountryDetail, CountryTimelineEntry } from "../../types/passport";

/**
 * The records that put one country in the passport — named AND opened.
 *
 * Owner's decision, 2026-09-02: *"immer schauen dass der User sieht wie die
 * Namen herkommen und veränderbar sind"*. Showing the tier is half the job; the
 * other half is that the record behind it must be one click away and editable.
 * Seeing "Rumänien · durch eine Unterkunft belegt" and being unable to reach
 * that lodging turns a diagnosis into a dead end — the wrongly geocoded hotel
 * that started all of this took a database session to find.
 *
 * `GET /stats/passport` carries `kinds[]` and nothing else: it says a country
 * was proved by a lodging, never WHICH lodging. So the ids come from the
 * drill-down `GET /stats/countries/:code`, fetched lazily when a reader asks.
 *
 * ## The lodging is now openable, and that is the whole point
 *
 * The drill-down used to know flights, port calls and places only, so a
 * country proved by a house alone answered 404 and this panel could name the
 * evidence but not reach it. Since 2026-09-02 it carries `lodgingId`, and the
 * one case the design was written for — `Hotel Sport`, place ID saying
 * Bucharest, address saying Otočec in Slovenia — is two clicks away. Czechia,
 * Italy and Slovenia in the owner's account open the same way.
 *
 * ## A 404 is still an ANSWER, and still not a failure
 *
 * It now means what it says: no flight, no port call, no place and no house
 * evidences this country. The cases that legitimately reach it — a house whose
 * only stay is a future booking, a house whose stays were all cancelled — prove
 * nothing to `lodgingEvidence` either, so they raise no passport row to open
 * this panel from. Reporting that as a broken request would put an incident on
 * screen for an empty set; reporting a broken request as "no records" would
 * claim a country has no evidence when it demonstrably has. Hence the two are
 * kept apart, and only `loadError` says the request failed.
 */

const isoDate = (iso: string | null, locale: string): string | null =>
  iso
    ? new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "2-digit" })
    : null;

/** Where the record lives, so a reader can correct it. */
const linkFor = (entry: CountryTimelineEntry): string => {
  switch (entry.kind) {
    case "flight":
      return `/flights/${entry.flightId}`;
    case "port":
      return `/cruises/${entry.cruiseId}`;
    case "place":
      return `/places/${entry.placeId}`;
    case "lodging":
      // The house itself, not the list. A list is where a reader starts
      // hunting; the design's promise is that they do not have to.
      return `/lodging/${entry.lodgingId}`;
  }
};

const labelFor = (entry: CountryTimelineEntry): string => {
  switch (entry.kind) {
    case "flight": {
      // A flight with no number is named by its route, and one with neither by
      // its id — a link a reader cannot name is still a link they can follow.
      const route = [entry.depIata, entry.arrIata].filter(Boolean).join(" → ");
      return entry.flightNumber ?? (route.length > 0 ? route : entry.flightId);
    }
    case "port":
      return entry.portName ?? entry.cruiseId;
    case "place":
    case "lodging":
      return entry.name;
  }
};

export default function CountryProvenance({ code }: { code: string }): JSX.Element {
  const { t, i18n } = useTranslation(["passport", "common"]);
  const locale = i18n.language === "de" ? "de-DE" : "en-GB";

  const [detail, setDetail] = useState<CountryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setFailure(null);
    statsApi
      .getCountryDetail(code)
      .then((data) => {
        if (live) setDetail(data);
      })
      .catch((err) => {
        if (!live) return;
        const kind = classifyLoadFailure(err);
        setFailure(kind);
        // A 404 says "nothing evidences this country" — an empty set, not an
        // incident. Logging it as an error would file an answer as a fault.
        if (kind === "loadError") logger.error("Failed to load country provenance:", err);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [code]);

  const timeline = detail?.timeline ?? [];
  // A 404 is an ANSWER, not a failure: the drill-down says "nothing evidences
  // this country" — all four kinds consulted. Only a real load error failed.
  const brokeDown = failure === "loadError";

  return (
    <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
      <p className="mb-2" style={{ color: "var(--text-muted)" }}>
        {t("passport:provenance.intro")}
      </p>

      {loading && <p style={{ color: "var(--text-muted)" }}>{t("common:loading.default")}</p>}

      {/* A failed drill-down must never read as "no records": the country is in
          the list precisely because records exist. */}
      {!loading && brokeDown && (
        <p style={{ color: "var(--text-muted)" }}>{t("passport:provenance.loadError")}</p>
      )}

      {!loading && !brokeDown && (
        <ul className="space-y-1">
          {timeline.map((entry) => {
            const date = isoDate(entry.date, locale);
            return (
              <li key={`${entry.kind}-${linkFor(entry)}-${entry.date ?? "undated"}`}>
                <Link
                  to={linkFor(entry)}
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {labelFor(entry)}
                </Link>
                <span className="ml-2" style={{ color: "var(--text-muted)" }}>
                  {t(`passport:kinds.${entry.kind}`)}
                  {" · "}
                  {/* A record with no date says so. It is not dated 1970, and it
                      is not undated-therefore-absent either. */}
                  {date ?? t("passport:value.undated")}
                </span>
              </li>
            );
          })}

          {detail?.timelineTruncated === true && (
            <li style={{ color: "var(--text-muted)" }}>{t("passport:provenance.truncated")}</li>
          )}

          {/* An empty answer — including the 404 above — says so plainly. It
              must not read as "the request failed", and it must not read as
              "this country has no evidence" either: the row exists because
              evidence does. It says no single record could be opened. */}
          {timeline.length === 0 && (
            <li style={{ color: "var(--text-muted)" }}>{t("passport:provenance.none")}</li>
          )}
        </ul>
      )}
    </div>
  );
}
