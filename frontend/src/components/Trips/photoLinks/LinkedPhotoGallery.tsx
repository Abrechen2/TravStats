import { useCallback, useEffect, useState, type JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { formatLocalDate } from "../../../lib/displayFormat";
import { logger } from "../../../lib/logger";
import { tripPhotoSourcesApi, type LinkedPhoto } from "../../../lib/api/tripPhotoSources";
import EnlargeButton from "../../common/photoViewer/EnlargeButton";
import { usePhotoViewer } from "../../common/photoViewer/usePhotoViewer";
import { largeUrl, type ViewerPhoto } from "../../common/photoViewer/viewerPhoto";
import { Button, Dialog } from "../../ui";

const PAGE = 60;
const TILE = 120;
const UNDATED = "undated";

interface Props {
  tripId: string;
  days: Array<{ day: string | null; count: number }>;
  onClose: () => void;
}

/**
 * Every linked photo of a trip, one day at a time: the day strip comes from the counts, and
 * only the chosen day's photos are requested, a page at a time, with lazily loading images —
 * a trip can hold hundreds of library photos. A photo opens in the shared viewer.
 */
export default function LinkedPhotoGallery({ tripId, days, onClose }: Props): JSX.Element {
  const { t } = useTranslation(["trips"]);
  const firstDay = days[0]?.day ?? (days.length > 0 ? UNDATED : "all");
  const [day, setDay] = useState<string>(firstDay);
  const [photos, setPhotos] = useState<LinkedPhoto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const viewer = usePhotoViewer();

  const load = useCallback(
    async (bucket: string, from: string | null): Promise<void> => {
      setLoading(true);
      try {
        const page = await tripPhotoSourcesApi.photos(tripId, {
          day: bucket,
          cursor: from,
          limit: PAGE,
        });
        setPhotos((prev) => (from ? [...prev, ...page.photos] : page.photos));
        setCursor(page.nextCursor);
        setFailed(false);
      } catch (err: unknown) {
        logger.error("LinkedPhotoGallery: load failed", err);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [tripId]
  );

  useEffect(() => {
    setPhotos([]);
    setCursor(null);
    void load(day, null);
  }, [day, load]);

  const label = (d: string | null): string =>
    d === null ? t("trips:photoLinks.gallery.undated") : formatLocalDate(d);
  const toViewer = (p: LinkedPhoto): ViewerPhoto => ({
    id: p.key,
    url: largeUrl(p.previewUrl),
    takenAt: p.takenAt,
    source: p.provider,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("trips:photoLinks.gallery.title")}
      closeLabel={t("trips:photoLinks.gallery.close")}
      maxWidth={1400}
    >
      <div className="flex flex-wrap gap-2 mb-4" role="tablist" data-testid="linked-gallery-days">
        {days.map((d) => {
          const key = d.day ?? UNDATED;
          return (
            <Button
              key={key}
              variant={key === day ? "primary" : "secondary"}
              aria-pressed={key === day}
              onClick={() => setDay(key)}
            >
              {label(d.day)} · {d.count}
            </Button>
          );
        })}
      </div>
      {failed && (
        <p role="alert" className="t-caption" style={{ color: "var(--color-danger)" }}>
          {t("trips:photoLinks.loadFailed")}{" "}
          <Button variant="secondary" onClick={() => void load(day, cursor)}>
            {t("trips:photoLinks.retry")}
          </Button>
        </p>
      )}
      <ul
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${TILE}px, 1fr))` }}
        data-testid="linked-gallery-grid"
      >
        {photos.map((p, index) => (
          <li key={p.key}>
            <EnlargeButton onOpen={() => viewer.open(photos.map(toViewer), index)}>
              <img
                src={p.url}
                alt={t("trips:photoLinks.gallery.alt")}
                loading="lazy"
                decoding="async"
                style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 6 }}
              />
            </EnlargeButton>
          </li>
        ))}
      </ul>
      {cursor && (
        <div className="mt-4">
          <Button variant="secondary" disabled={loading} onClick={() => void load(day, cursor)}>
            {t("trips:photoLinks.gallery.loadMore")}
          </Button>
        </div>
      )}
      {viewer.viewer}
    </Dialog>
  );
}
