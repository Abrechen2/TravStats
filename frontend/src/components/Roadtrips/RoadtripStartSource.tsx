import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import Button from "../ui/Button";
import { Field, Input } from "../ui/Field";
import { useTranslation } from "../../hooks/useTranslation";
import { listLodgings } from "../../lib/api/lodging";
import { logger } from "../../lib/logger";
import { resolveWaypoints } from "../../lib/roadtrip/resolveWaypoints";
import {
  MAX_START_STATIONS,
  parseGpxStations,
  parseMapsLink,
  type StartPoint,
} from "../../lib/roadtrip/startSources";
import type { Lodging } from "../../types/lodging";

export type StartMode = "empty" | "lodging" | "gpx" | "link";
const MODES: StartMode[] = ["empty", "lodging", "gpx", "link"];
const SHOWN_LODGINGS = 8;

/**
 * "Wie fängt der Roadtrip an?": an empty roadtrip, or one that already holds
 * the stations of a lodging picked from the library, a GPX file or a Maps
 * link. Each source says exactly why it gave nothing; a source that failed
 * leaves the stations empty rather than half-filled.
 */
export default function RoadtripStartSource({
  onPoints,
}: {
  /** The stations the chosen source gives — empty while none is chosen or the source failed. */
  onPoints: (points: StartPoint[]) => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  const [mode, setMode] = useState<StartMode>("empty");
  // Bumped on every choice, the chosen one included: the parent has dropped
  // its stations, so the source must forget its pick or its file as well.
  const [round, setRound] = useState(0);
  const pick = (next: StartMode): void => {
    setMode(next);
    setRound((n) => n + 1);
    onPoints([]);
  };
  return (
    <fieldset
      className="flex flex-col"
      style={{ gap: "var(--ts-space-sm)", border: 0, padding: 0, margin: 0 }}
    >
      <legend className="t-caption" style={{ marginBottom: "var(--ts-space-sm)" }}>
        {t("roadtrips:startFrom.legend")}
      </legend>
      <div className="grid grid-cols-2 sm:grid-cols-4" style={{ gap: "var(--ts-space-sm)" }}>
        {MODES.map((m) => {
          const on = m === mode;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              onClick={() => pick(m)}
              style={{
                minHeight: "var(--ts-size-touch-min)",
                borderRadius: "var(--ts-radius-button)",
                border: `2px solid ${on ? "var(--domain-roadtrip)" : "var(--ts-border)"}`,
                background: on ? "var(--domain-roadtrip-soft)" : "var(--ts-surface)",
                color: on ? "var(--ts-text-bright)" : "var(--ts-text)",
                fontWeight: on ? 800 : 500,
                fontSize: 14,
              }}
            >
              {t(`roadtrips:startFrom.${m}`)}
            </button>
          );
        })}
      </div>
      {mode === "lodging" && <LodgingSource key={round} onPoints={onPoints} />}
      {mode === "gpx" && <GpxSource key={round} onPoints={onPoints} />}
      {mode === "link" && <LinkSource key={round} onPoints={onPoints} />}
    </fieldset>
  );
}

function Problem({ children }: { children: string }): JSX.Element {
  return (
    <p role="alert" style={{ fontSize: 13, color: "var(--ts-bad)" }}>
      {children}
    </p>
  );
}

function LodgingSource({ onPoints }: { onPoints: (p: StartPoint[]) => void }): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  const [lodgings, setLodgings] = useState<Lodging[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    listLodgings({})
      .then((rows) => !cancelled && setLodgings(rows))
      .catch((err: unknown) => {
        // Not "[]": an empty list would read as "you have no lodgings".
        logger.warn("Loading lodgings for a new roadtrip failed", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (lodgings ?? [])
      .filter((l) => q === "" || `${l.name} ${l.city ?? ""}`.toLowerCase().includes(q))
      .slice(0, q === "" ? SHOWN_LODGINGS : 50);
  }, [lodgings, query]);

  if (failed) {
    return (
      <div className="flex flex-col" style={{ gap: 6 }}>
        <Problem>{t("roadtrips:startFrom.lodgingLoadFailed")}</Problem>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          {t("roadtrips:startFrom.retry")}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col" style={{ gap: 6 }}>
      <Input
        aria-label={t("roadtrips:startFrom.lodgingSearch")}
        placeholder={t("roadtrips:startFrom.lodgingSearch")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {lodgings !== null && rows.length === 0 && (
        <p className="t-caption">{t("roadtrips:startFrom.lodgingNone")}</p>
      )}
      <ul className="flex flex-col" style={{ gap: 4 }}>
        {rows.map((l) => {
          const placed = l.lat !== null && l.lon !== null;
          return (
            <li key={l.id}>
              <button
                type="button"
                disabled={!placed}
                aria-pressed={chosen === l.id}
                onClick={() => {
                  if (l.lat === null || l.lon === null) return;
                  setChosen(l.id);
                  onPoints([{ title: l.name, lat: l.lat, lon: l.lon }]);
                }}
                className="w-full text-left pointer-coarse:min-h-(--ts-size-touch-min)"
                style={{
                  padding: "6px 10px",
                  borderRadius: "var(--ts-radius-button)",
                  border: `1px solid ${chosen === l.id ? "var(--domain-roadtrip)" : "var(--ts-border)"}`,
                  background: "var(--ts-surface)",
                  color: "inherit",
                  opacity: placed ? 1 : 0.6,
                }}
              >
                <span style={{ fontWeight: 700 }}>{l.name}</span>{" "}
                <span className="t-caption">
                  {[l.city, l.country].filter(Boolean).join(", ")}
                  {placed ? "" : ` · ${t("roadtrips:startFrom.lodgingNoCoords")}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GpxSource({ onPoints }: { onPoints: (p: StartPoint[]) => void }): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  const [problem, setProblem] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  // A newer choice (or leaving the source) makes an older read's answer stale.
  const run = useRef(0);
  useEffect(
    () => () => {
      run.current += 1;
    },
    []
  );

  const read = async (file: File): Promise<void> => {
    const mine = ++run.current;
    setProblem(null);
    setSummary(null);
    onPoints([]);
    let text: string;
    try {
      text = await file.text();
      if (mine !== run.current) return;
    } catch (err) {
      if (mine !== run.current) return;
      logger.warn("Reading a GPX file for a new roadtrip failed", err);
      setProblem(t("roadtrips:startFrom.gpxError.read"));
      return;
    }
    const result = parseGpxStations(text);
    if (!result.ok) {
      setProblem(
        t(`roadtrips:startFrom.gpxError.${result.reason}`, {
          count: result.count,
          max: MAX_START_STATIONS,
        })
      );
      return;
    }
    setSummary(
      t(`roadtrips:startFrom.gpxFrom.${result.from}`, {
        count: result.points.length,
        file: file.name,
      })
    );
    onPoints(result.points);
  };

  return (
    <div className="flex flex-col" style={{ gap: 6 }}>
      <input
        type="file"
        accept=".gpx,application/gpx+xml,application/xml,text/xml"
        aria-label={t("roadtrips:startFrom.gpxChoose")}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void read(file);
        }}
      />
      {summary && (
        <p role="status" className="t-caption">
          {summary}
        </p>
      )}
      {problem && <Problem>{problem}</Problem>}
    </div>
  );
}

function LinkSource({ onPoints }: { onPoints: (p: StartPoint[]) => void }): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips"]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = useRef(0);
  useEffect(
    () => () => {
      run.current += 1;
    },
    []
  );

  const read = async (): Promise<void> => {
    const mine = ++run.current;
    setProblem(null);
    onPoints([]);
    const parsed = parseMapsLink(text);
    if (!parsed.ok) {
      setProblem(t(`roadtrips:startFrom.linkError.${parsed.reason}`));
      return;
    }
    setBusy(true);
    try {
      const resolved = await resolveWaypoints(parsed.waypoints, i18n.language);
      // The link was edited or the source left while the places were looked up.
      if (mine !== run.current) return;
      if (!resolved.ok) {
        setProblem(t(`roadtrips:startFrom.linkError.${resolved.reason}`, { name: resolved.name }));
        return;
      }
      onPoints(resolved.points);
    } finally {
      if (mine === run.current) setBusy(false);
    }
  };

  return (
    <div className="flex flex-col" style={{ gap: 6 }}>
      <Field
        label={t("roadtrips:startFrom.linkLabel")}
        htmlFor="roadtrip-new-maps-link"
        hint={t("roadtrips:startFrom.linkHint")}
      >
        <Input
          id="roadtrip-new-maps-link"
          inputMode="url"
          value={text}
          onChange={(e) => {
            run.current += 1;
            setBusy(false);
            setText(e.target.value);
            onPoints([]);
          }}
        />
      </Field>
      <Button variant="secondary" disabled={busy || text.trim() === ""} onClick={() => void read()}>
        {busy ? t("roadtrips:startFrom.linkReading") : t("roadtrips:startFrom.linkRead")}
      </Button>
      {problem && <Problem>{problem}</Problem>}
    </div>
  );
}
