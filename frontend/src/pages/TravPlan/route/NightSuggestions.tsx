import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui";
import { useTranslation } from "../../../hooks/useTranslation";
import {
  isOpenDataDisabled,
  openDataApi,
  openDataUpstreamFailure,
  type NearbyLodging,
} from "../../../lib/api/openData";
import type { PlanNightCandidate, PlanPlace, PlanVehicle } from "../../../lib/api/travplan";
import { newPlanId } from "../../../lib/travplanId";
import { logger } from "../../../lib/logger";
import { appLocale } from "../../../lib/units";
import { PlanNotice } from "../planLayout";

/** Wide enough to cover a valley or a stretch of coast around the station. */
export const SUGGEST_RADIUS_KM = 10;
/** Three at a time: a short list to choose from, not a directory to read. */
export const SUGGEST_PAGE = 3;
const CAMP_KINDS = new Set(["camp_site", "caravan_site"]);
export const CAMPING_VEHICLES = new Set<PlanVehicle["kind"]>(["motorhome", "campervan", "caravan"]);

/**
 * Places to sleep in the order that fits the trip: someone in a motorhome sees campsites and
 * pitches first, everyone else houses first; nearest first within each group. Nothing is dropped,
 * so a motorhome trip in a town without a campsite still sees the hotels.
 */
export function rankLodging(
  places: NearbyLodging[],
  vehicle: PlanVehicle["kind"] | null
): NearbyLodging[] {
  const camping = vehicle !== null && CAMPING_VEHICLES.has(vehicle);
  const group = (p: NearbyLodging) => (CAMP_KINDS.has(p.kind) === camping ? 0 : 1);
  return [...places].sort((a, b) => group(a) - group(b) || a.distanceM - b.distanceM);
}

export function candidateFrom(
  place: NearbyLodging,
  near: PlanPlace,
  kindLabel: string
): PlanNightCandidate {
  return {
    id: newPlanId(),
    title: place.name,
    place: {
      name: place.name,
      lat: place.lat,
      lon: place.lon,
      country: near.country,
      zone: near.zone,
      ref: null,
    },
    url: place.website,
    note: `${kindLabel} · OpenStreetMap`,
  };
}

type Lookup =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "done"; places: NearbyLodging[]; shown: number }
  | { state: "failed"; reason: "timeout" | "rateLimited" | "unavailable" | "disabled" };

const km = (m: number) =>
  new Intl.NumberFormat(appLocale(), { maximumFractionDigits: 1 }).format(m / 1000);

/**
 * "Where could we sleep?" for one station: campsites, pitches and houses OpenStreetMap knows
 * around it, three at a time, each with its kind and distance. Taking one adds it as a night
 * candidate; nothing is booked and no price or availability is claimed. "None nearby" and
 * "OpenStreetMap did not answer" are told apart.
 */
export function NightSuggestions({
  near,
  vehicle,
  taken,
  onTake,
}: {
  near: PlanPlace;
  vehicle: PlanVehicle["kind"] | null;
  /** Names already among the candidates, so a suggestion is not offered twice. */
  taken: string[];
  onTake: (candidate: PlanNightCandidate) => void;
}) {
  const { t } = useTranslation("travplan"),
    [lookup, setLookup] = useState<Lookup>({ state: "idle" }),
    run = useRef(0);
  // A list for the old place would offer the wrong town's campsites.
  useEffect(() => {
    run.current += 1;
    setLookup({ state: "idle" });
  }, [near.lat, near.lon]);

  const kindLabel = (kind: string) =>
    t("route.suggest.kind." + kind, { defaultValue: t("route.suggest.kind.other") });
  async function search() {
    const mine = ++run.current;
    setLookup({ state: "loading" });
    try {
      const places = await openDataApi.nearbyLodgings(near.lat, near.lon, SUGGEST_RADIUS_KM);
      if (mine !== run.current) return;
      setLookup({ state: "done", places: rankLodging(places, vehicle), shown: SUGGEST_PAGE });
    } catch (err) {
      if (mine !== run.current) return;
      logger.warn("Night suggestions near a plan station failed", err);
      const upstream = openDataUpstreamFailure(err);
      setLookup({
        state: "failed",
        reason: isOpenDataDisabled(err)
          ? "disabled"
          : upstream === "clientTimeout"
            ? "timeout"
            : (upstream ?? "unavailable"),
      });
    }
  }

  const open = lookup.state === "done" ? lookup.places.filter((p) => !taken.includes(p.name)) : [];
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <div>
        <Button disabled={lookup.state === "loading"} onClick={() => void search()}>
          {lookup.state === "loading"
            ? t("route.suggest.searching")
            : t("route.suggest.search", { km: SUGGEST_RADIUS_KM })}
        </Button>
      </div>
      {lookup.state === "failed" && (
        <PlanNotice tone="bad">{t("route.suggest.failed." + lookup.reason)}</PlanNotice>
      )}
      {lookup.state === "done" && open.length === 0 && (
        <p className="t-caption">{t("route.suggest.none", { km: SUGGEST_RADIUS_KM })}</p>
      )}
      {lookup.state === "done" && open.length > 0 && (
        <>
          <ul
            aria-label={t("route.suggest.list")}
            className="flex flex-col"
            style={{ gap: "var(--ts-space-sm)" }}
          >
            {open.slice(0, lookup.shown).map((p) => (
              <li
                key={p.osmRef}
                className="flex items-center"
                style={{ gap: "var(--ts-space-md)" }}
              >
                <span className="t-body min-w-0 flex-1">
                  {p.name}
                  <span className="t-caption">
                    {" · "}
                    {kindLabel(p.kind)} · {t("route.suggest.distance", { km: km(p.distanceM) })}
                  </span>
                </span>
                <Button
                  aria-label={t("route.suggest.take", { name: p.name })}
                  onClick={() => onTake(candidateFrom(p, near, kindLabel(p.kind)))}
                >
                  {t("route.suggest.takeShort")}
                </Button>
              </li>
            ))}
          </ul>
          {open.length > lookup.shown && (
            <div>
              <Button onClick={() => setLookup({ ...lookup, shown: lookup.shown + SUGGEST_PAGE })}>
                {t("route.suggest.more")}
              </Button>
            </div>
          )}
          <p className="t-caption">{t("route.suggest.source")}</p>
        </>
      )}
    </div>
  );
}
