import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import type { Feature, Geometry } from "geojson";
import { useInView } from "../../../hooks/useInView";
import { useTodayZone } from "../../../hooks/useTodayZone";
import { useTranslation } from "../../../hooks/useTranslation";
import { loadWorldCountries } from "../../../lib/geo/worldCountries";
import { logger } from "../../../lib/logger";
import { shapeCode } from "../../../pages/Track/countries/visitedCountries";
import { customSpan, spanPath } from "../../../pages/Track/map/trackSpan";
import { todayIn } from "../../../shared/time/clock";
import { sectionFacts, type SectionWindow } from "./sectionGeometry";
import {
  dayBarFor,
  formatDuration,
  formatKm,
  formatSpan,
  formatSpeed,
  linkDays,
  zoneOrUtc,
} from "./sectionFormat";
import { useSectionTrack } from "./useSectionTrack";

const SectionMap = lazy(() => import("./SectionMap"));

/**
 * The part of the history an inbox question stands on (owner, 2026-10-26,
 * board "Posteingang · Fragen mit Track-Abschnitt"): a small map of exactly
 * that section, the facts it carries, a day bar, why the question is asked,
 * and a way onto the Track map. Read from the privacy-safe range only, and
 * only once the card is on screen.
 *
 * Every fact abstains (—) where the section cannot say it. A failed read says
 * which failure it was, and a section with nothing left says that, instead of
 * an empty map.
 */

export interface SectionFact {
  label: string;
  value: string;
}

export interface TrackSectionPanelProps {
  window: SectionWindow;
  /** The question's own clock, for the times it shows. */
  zone: string | null;
  /** The "Warum gefragt" sentence, as a `track:inbox.why.*` key. */
  why: { key: string; values?: Record<string, unknown> };
  /** Facts the question itself carries (a lodging it matches), labelled by a `track:` key. */
  facts?: Array<{ labelKey: string; value: string }>;
  /** Lines for "Mehr anzeigen" the question itself knows. */
  more?: string[];
  coverage?: "complete" | "truncated" | "unreachable" | null;
  ring?: { lat: number; lon: number; radiusM: number } | null;
  /** ISO alpha-2 of a country question: its outline is drawn under the line. */
  countryCode?: string | null;
}

function useCountryShape(code: string | null | undefined, enabled: boolean) {
  const [shape, setShape] = useState<Feature<Geometry> | null>(null);
  useEffect(() => {
    if (!code || !enabled) return;
    let live = true;
    loadWorldCountries()
      .then((world) => {
        if (live) setShape(world.features.find((f) => shapeCode(f) === code.toUpperCase()) ?? null);
      })
      // The outline is a backdrop: without it the section still reads.
      .catch((err: unknown) => logger.warn("Country outline for an inbox question failed", err));
    return () => {
      live = false;
    };
  }, [code, enabled]);
  return shape;
}

export default function TrackSectionPanel(props: TrackSectionPanelProps): JSX.Element {
  const { t, i18n } = useTranslation(["track"]);
  const { ref, inView, seen } = useInView<HTMLDivElement>();
  const state = useSectionTrack(props.window, seen);
  const country = useCountryShape(props.countryCode, seen);
  const [open, setOpen] = useState(false);
  const zone = zoneOrUtc(props.zone);
  const profileZone = useTodayZone();
  const locale = i18n.language;

  const loaded = state.kind === "loaded" ? state.stretches : null;
  const facts = useMemo(() => (loaded ? sectionFacts(loaded) : null), [loaded]);
  const none = t("track:inbox.value.none");
  const rows: SectionFact[] = [
    { label: t("track:inbox.fact.span"), value: formatSpan(props.window, zone, t) },
    {
      label: t("track:inbox.fact.duration"),
      value: formatDuration(props.window.untilMs - props.window.fromMs, t),
    },
    { label: t("track:inbox.fact.distance"), value: formatKm(facts?.distanceM ?? null, locale, t) },
    {
      label: t("track:inbox.fact.speed"),
      value: formatSpeed(facts?.avgKmh ?? null, facts?.maxKmh ?? null, locale, t),
    },
    { label: t("track:inbox.fact.points"), value: facts ? String(facts.points) : none },
    ...(props.facts ?? []).map((f) => ({ label: t(f.labelKey), value: f.value })),
  ];
  const bar = dayBarFor(props.window, zone);
  const days = linkDays(props.window, profileZone);
  const today = todayIn(profileZone);
  const href = spanPath(customSpan(days.fromDay, days.toDay, today), today);

  const details = [
    ...((state.kind === "loaded" || state.kind === "empty") && state.truncated
      ? [t("track:inbox.detail.truncated")]
      : []),
    ...(props.coverage === "truncated" ? [t("track:inbox.detail.coverageTruncated")] : []),
    ...(props.coverage === "unreachable" ? [t("track:inbox.detail.coverageUnreachable")] : []),
    ...(facts
      ? [
          facts.cuts > 0
            ? t("track:inbox.detail.cuts", { count: facts.cuts })
            : t("track:inbox.detail.noCuts"),
          t("track:inbox.detail.points", { count: facts.points }),
        ]
      : []),
    ...(props.more ?? []),
  ];

  return (
    <div
      ref={ref}
      className="grid gap-3 md:grid-cols-[1fr_minmax(0,22rem)]"
      data-testid="track-section"
    >
      <div className="grid content-start gap-3">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="track-section-facts">
          {rows.map((row) => (
            <div key={row.label} className="rounded-lg bg-(--ts-tile) px-3 py-2">
              <dt className="t-caption">{row.label}</dt>
              <dd className="font-semibold tabular-nums">{row.value}</dd>
            </div>
          ))}
        </dl>
        {bar && (
          <div className="grid gap-1" data-testid="track-section-daybar">
            <span className="t-caption">{t("track:inbox.dayBar")}</span>
            <div
              aria-hidden="true"
              className="relative h-3 overflow-hidden rounded-full bg-(--ts-tile)"
            >
              <div
                className="absolute inset-y-0 bg-(--ts-live)"
                style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
              />
            </div>
          </div>
        )}
        <p className="text-sm">
          <span className="font-semibold">{t("track:inbox.whyLabel")}</span>{" "}
          {t(props.why.key, props.why.values)}
        </p>
        {open && details.length > 0 && (
          <ul className="list-disc pl-5 text-sm" data-testid="track-section-more">
            {details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {details.length > 0 && (
          <button
            type="button"
            className="justify-self-start text-sm text-(--ts-live) underline"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? t("track:inbox.less") : t("track:inbox.more")}
          </button>
        )}
      </div>
      <figure className="m-0 grid content-start gap-2">
        {(state.kind === "idle" || state.kind === "loading") && (
          <p className="t-caption" role="status">
            {t("track:inbox.loading")}
          </p>
        )}
        {state.kind === "failed" && (
          <p className="text-sm text-(--ts-bad)" role="alert">
            {t(state.key)}
          </p>
        )}
        {state.kind === "empty" && (
          <p className="t-caption" role="status">
            {t("track:inbox.empty")}
          </p>
        )}
        {/* Mounted only while on screen: a browser holds few WebGL contexts, an inbox many cards. */}
        {state.kind === "loaded" &&
          (inView ? (
            <Suspense fallback={<div className="h-56" />}>
              <SectionMap
                stretches={state.stretches}
                label={t("track:inbox.mapLabel")}
                ring={props.ring ?? null}
                country={country}
              />
            </Suspense>
          ) : (
            <div className="h-56" aria-hidden="true" />
          ))}
        <figcaption className="flex flex-wrap justify-between gap-2 t-caption">
          <span>{t("track:inbox.zonesNeverDrawn")}</span>
          <Link to={href} data-testid="track-section-link">
            {t("track:inbox.openOnMap")}
          </Link>
        </figcaption>
      </figure>
    </div>
  );
}
