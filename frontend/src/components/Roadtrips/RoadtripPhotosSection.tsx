import { useCallback, useEffect, useMemo, useState, type JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import {
  getEntryPhotoSuggestions,
  linkEntryPhotos,
  type EntryPhotoSuggestion,
} from "../../lib/api/entryPhotos";
import { roadtripsApi } from "../../lib/api/roadtrips";
import { logger } from "../../lib/logger";
import { formatLocalDate } from "../../lib/format";
import type { RoadtripPhoto, RoadtripPhotos } from "../../types/roadtrip";
import EnlargeButton from "../common/photoViewer/EnlargeButton";
import { usePhotoViewer } from "../common/photoViewer/usePhotoViewer";
import { largeUrl, type ViewerPhoto } from "../common/photoViewer/viewerPhoto";
import { Button } from "../ui";

const TILE = 96;
const LINKED_BORDER = "2px solid var(--accent)";
const WINDOW_BORDER = "2px dashed var(--color-border)";

interface Candidate extends EntryPhotoSuggestion {
  stationId: string;
  stationTitle: string;
}

/**
 * The roadtrip's "Fotos" section: everything that belongs to it, grouped by day. Only the
 * chosen day's pictures are drawn (the trip gallery's pattern) — a roadtrip is weeks long.
 * Linked photos have a solid frame; photos that only fit the days and the route are dashed
 * and carry a one-click "link to station" — nothing is linked in bulk (owner rule).
 */
export default function RoadtripPhotosSection({ roadtripId }: { roadtripId: string }): JSX.Element {
  const { t } = useTranslation(["roadtrips", "common"]);
  const [data, setData] = useState<RoadtripPhotos | null>(null);
  const [failed, setFailed] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [linkError, setLinkError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [library, setLibrary] = useState<{ items: Candidate[]; problem: boolean } | null>(null);
  const viewer = usePhotoViewer();

  const load = useCallback(async (): Promise<void> => {
    try {
      setData(await roadtripsApi.photos(roadtripId));
      setFailed(false);
    } catch (err: unknown) {
      logger.error("RoadtripPhotosSection: load failed", err);
      setFailed(true);
    }
  }, [roadtripId]);
  useEffect(() => void load(), [load]);

  const days = useMemo(() => {
    const set = new Set<string>();
    for (const p of data?.photos ?? []) if (p.day) set.add(p.day);
    for (const s of data?.stations ?? []) if (s.day) set.add(s.day);
    return [...set].sort();
  }, [data]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data?.photos ?? []) if (p.day) m.set(p.day, (m.get(p.day) ?? 0) + 1);
    return m;
  }, [data]);
  const chosen = day ?? days.find((d) => counts.has(d)) ?? days[0] ?? null;

  useEffect(() => setLibrary(null), [chosen]);

  if (failed) {
    return (
      <section className="mt-8" data-testid="roadtrip-photos">
        <h2 className="t-card-title">{t("roadtrips:photos.title")}</h2>
        <p role="alert" className="t-caption" style={{ color: "var(--color-danger)" }}>
          {t("roadtrips:photos.loadFailed")}{" "}
          <Button variant="secondary" onClick={() => void load()}>
            {t("roadtrips:photos.retry")}
          </Button>
        </p>
      </section>
    );
  }
  if (data === null) return <section className="mt-8" aria-busy="true" />;

  const shown = data.photos.filter((p) => p.day === chosen);
  const linkedTotal = data.photos.filter((p) => p.kind === "linked").length;
  const windowTotal = data.photos.length - linkedTotal;
  const stationsOfDay = data.stations.filter((s) => s.day === chosen);

  const toViewer = (p: RoadtripPhoto): ViewerPhoto => ({
    id: p.key,
    url: largeUrl(p.url),
    caption: p.caption,
    takenAt: p.takenAt,
    place: p.stationTitle,
    source: p.source,
    entry: { href: `/roadtrips/${roadtripId}`, label: t("roadtrips:photos.toRoadtrip") },
  });

  const link = async (work: () => Promise<void>, key: string): Promise<void> => {
    setBusy(key);
    setLinkError(false);
    try {
      await work();
      await load();
    } catch (err: unknown) {
      logger.error("RoadtripPhotosSection: link failed", err);
      setLinkError(true);
    } finally {
      setBusy(null);
    }
  };

  const searchLibrary = async (): Promise<void> => {
    const items: Candidate[] = [];
    let problem = false;
    for (const s of stationsOfDay) {
      try {
        const found = await getEntryPhotoSuggestions("roadtripStop", s.id);
        if (Object.values(found.sources).some((v) => v !== "ok" && v !== "notConfigured"))
          problem = true;
        const linked = new Set(data.photos.map((p) => p.url));
        items.push(
          ...found.suggestions
            .filter((x) => !linked.has(x.url))
            .map((x) => ({ ...x, stationId: s.id, stationTitle: s.title }))
        );
      } catch (err: unknown) {
        logger.error("RoadtripPhotosSection: library search failed", err);
        problem = true;
      }
    }
    setLibrary({ items, problem });
  };

  const tile = (p: RoadtripPhoto, index: number): JSX.Element => (
    <li key={p.key} className="flex flex-col gap-1" style={{ width: TILE }}>
      <EnlargeButton onOpen={() => viewer.open(shown.map(toViewer), index)}>
        <img
          src={p.url}
          alt={p.caption ?? t("roadtrips:photos.alt")}
          width={TILE}
          height={TILE}
          loading="lazy"
          style={{
            width: TILE,
            height: TILE,
            objectFit: "cover",
            borderRadius: 6,
            border: p.kind === "linked" ? LINKED_BORDER : WINDOW_BORDER,
          }}
        />
      </EnlargeButton>
      <span className="text-[10px] leading-4" style={{ color: "var(--text-muted)" }}>
        {t(p.kind === "linked" ? "roadtrips:photos.linked" : "roadtrips:photos.fits")}
      </span>
      {p.kind === "window" && p.tripId && p.tripPhotoId && p.stationId && (
        <button
          type="button"
          disabled={busy !== null}
          className="self-start text-[11px] underline disabled:opacity-50"
          onClick={() =>
            void link(
              () => roadtripsApi.fileUploadAtStation(p.tripId!, p.tripPhotoId!, p.stationId!),
              p.key
            )
          }
        >
          {t("roadtrips:photos.linkTo", { station: p.stationTitle })}
        </button>
      )}
    </li>
  );

  return (
    <section className="mt-8 flex flex-col gap-3" data-testid="roadtrip-photos">
      {viewer.viewer}
      <h2 className="t-card-title">
        {t("roadtrips:photos.title")} · {linkedTotal + windowTotal}
      </h2>
      <p className="t-caption">
        {t("roadtrips:photos.legend", { linked: linkedTotal, fits: windowTotal })}
      </p>
      {data.truncated && (
        <p role="status" className="t-caption">
          {t("roadtrips:photos.truncated")}
        </p>
      )}
      {linkError && (
        <p role="alert" className="t-caption" style={{ color: "var(--color-danger)" }}>
          {t("roadtrips:photos.linkFailed")}
        </p>
      )}
      {days.length === 0 ? (
        <p className="t-caption">{t("roadtrips:photos.noDays")}</p>
      ) : (
        <div role="group" aria-label={t("roadtrips:photos.days")} className="flex flex-wrap gap-2">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={d === chosen}
              onClick={() => setDay(d)}
              className="rounded-md px-2 py-1 text-xs"
              style={{
                border: d === chosen ? LINKED_BORDER : "1px solid var(--color-border)",
              }}
            >
              {formatLocalDate(d)} · {counts.get(d) ?? 0}
            </button>
          ))}
        </div>
      )}
      {chosen && shown.length === 0 && (
        <p className="t-caption">{t("roadtrips:photos.noneOnDay")}</p>
      )}
      {shown.length > 0 && <ul className="flex flex-wrap gap-3">{shown.map(tile)}</ul>}
      {chosen && stationsOfDay.length > 0 && (
        <div className="flex flex-col gap-2">
          <Button variant="secondary" onClick={() => void searchLibrary()}>
            {t("roadtrips:photos.searchLibrary")}
          </Button>
          {library?.problem && (
            <p role="alert" className="t-caption" style={{ color: "var(--color-danger)" }}>
              {t("roadtrips:photos.libraryProblem")}
            </p>
          )}
          {library && library.items.length === 0 && !library.problem && (
            <p className="t-caption">{t("roadtrips:photos.libraryNone")}</p>
          )}
          {library && library.items.length > 0 && (
            <ul className="flex flex-wrap gap-3">
              {library.items.map((c, i) => (
                <li key={c.url} className="flex flex-col gap-1" style={{ width: TILE }}>
                  <EnlargeButton
                    onOpen={() =>
                      viewer.open(
                        library.items.map((x) => ({
                          id: x.url,
                          url: largeUrl(x.url),
                          takenAt: x.takenAt,
                          place: x.stationTitle,
                          source: x.provider,
                        })),
                        i
                      )
                    }
                  >
                    <img
                      src={c.url}
                      alt={t("roadtrips:photos.alt")}
                      width={TILE}
                      height={TILE}
                      loading="lazy"
                      style={{
                        width: TILE,
                        height: TILE,
                        objectFit: "cover",
                        borderRadius: 6,
                        border: WINDOW_BORDER,
                      }}
                    />
                  </EnlargeButton>
                  <button
                    type="button"
                    disabled={busy !== null}
                    className="self-start text-[11px] underline disabled:opacity-50"
                    onClick={() =>
                      void link(async () => {
                        await linkEntryPhotos("roadtripStop", c.stationId, c.provider, [c.assetId]);
                        setLibrary((cur) =>
                          cur ? { ...cur, items: cur.items.filter((x) => x.url !== c.url) } : cur
                        );
                      }, c.url)
                    }
                  >
                    {t("roadtrips:photos.linkTo", { station: c.stationTitle })}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
