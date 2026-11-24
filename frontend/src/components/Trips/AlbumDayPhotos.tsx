import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useLocale } from "../../hooks/useLocale";
import { failureKey, immichApi, immichFailureKind } from "../../lib/api/immich";
import { logger } from "../../lib/logger";
import { groupByDay } from "../../lib/galleryGrouping";
import type { ImmichGalleryAsset, PhotoSourceKind } from "../../types/immich";
import LazyThumb from "./LazyThumb";
import { formatDayChip } from "./GalleryDayStrip";

/** Photos per request. A tile row is 3-5 across, so this is a dozen or so rows. */
export const DAY_PAGE_SIZE = 60;
/** Pages read while completing the list for the lightbox: metadata only, so larger. */
const REST_PAGE_SIZE = 200;

interface Props {
  tripId: string;
  linkId: string;
  provider: PhotoSourceKind;
  albumName: string;
  /** `YYYY-MM-DD`, `undated` or `all`. */
  day: string;
  /** The zone the server cut its days in; "Alle" groups the same way. */
  zone: string;
  /** Show a header per local day (grouped "Alle" view). */
  headers: boolean;
  /** Bumped by the parent after a re-sync so the page is read again. */
  reloadToken: number;
  onOpen: (items: ImmichGalleryAsset[], index: number) => void;
}

/**
 * The photos of ONE day (or "Alle"), a page at a time. Only the chosen day is
 * requested; the next page follows when the sentinel nears the viewport, and a
 * failure is shown with its own reason and a retry instead of an empty grid.
 */
export default function AlbumDayPhotos({
  tripId,
  linkId,
  provider,
  albumName,
  day,
  zone,
  headers,
  reloadToken,
  onOpen,
}: Props): JSX.Element {
  const { t } = useTranslation("immich");
  const locale = useLocale();
  const [assets, setAssets] = useState<ImmichGalleryAsset[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  // A response for a day the user has already left must not land in the new one.
  const generation = useRef(0);
  const inFlight = useRef(false);

  const loadPage = useCallback(
    async (offset: number, mine: number): Promise<void> => {
      inFlight.current = true;
      setLoading(true);
      setFailure(null);
      try {
        const page = await immichApi.getAlbumDayAssets(tripId, linkId, day, offset, DAY_PAGE_SIZE);
        if (generation.current !== mine) return;
        setAssets((prev) => (offset === 0 ? page.assets : [...prev, ...page.assets]));
        setNextOffset(page.nextOffset);
      } catch (error) {
        if (generation.current !== mine) return;
        logger.warn("Gallery day failed to load", { provider, kind: immichFailureKind(error) });
        setFailure(failureKey(immichFailureKind(error), provider));
      } finally {
        if (generation.current === mine) {
          inFlight.current = false;
          setLoading(false);
        }
      }
    },
    [tripId, linkId, day, provider]
  );

  useEffect(() => {
    generation.current += 1;
    setAssets([]);
    setNextOffset(null);
    void loadPage(0, generation.current);
    return () => {
      generation.current += 1;
    };
  }, [loadPage, reloadToken]);

  const loadMore = useCallback((): void => {
    if (nextOffset === null || inFlight.current) return;
    void loadPage(nextOffset, generation.current);
  }, [nextOffset, loadPage]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || nextOffset === null || failure || typeof IntersectionObserver === "undefined") {
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "200% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [nextOffset, failure, loadMore]);

  const groups = useMemo(
    () => (headers ? groupByDay(assets, zone) : null),
    [headers, assets, zone]
  );

  // The lightbox steps through the list it is given, so it must hold the whole
  // day, not just the pages scrolled into view. Only metadata is read here —
  // the images stay lazy — and a failure is shown like any other page failure.
  const open = async (index: number): Promise<void> => {
    let all = assets;
    let offset = nextOffset;
    const mine = generation.current;
    try {
      while (offset !== null) {
        const page = await immichApi.getAlbumDayAssets(tripId, linkId, day, offset, REST_PAGE_SIZE);
        if (generation.current !== mine) return;
        all = [...all, ...page.assets];
        offset = page.nextOffset;
      }
      setAssets(all);
      setNextOffset(null);
    } catch (error) {
      if (generation.current !== mine) return;
      logger.warn("Gallery day failed to load", { provider, kind: immichFailureKind(error) });
      setFailure(failureKey(immichFailureKind(error), provider));
    }
    onOpen(all, index);
  };

  const tile = (asset: ImmichGalleryAsset, index: number): JSX.Element => (
    <button key={asset.id} type="button" onClick={() => void open(index)} aria-label={albumName}>
      <LazyThumb src={asset.url} alt={albumName} />
    </button>
  );
  const grid = "grid grid-cols-3 gap-2 md:grid-cols-5";

  return (
    <div>
      {groups ? (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.day ?? "undated"}>
              <h4
                data-testid={group.day ? "gallery-day-header" : "gallery-undated-header"}
                className="mb-1.5 text-sm font-semibold text-(--text-secondary)"
              >
                {group.day ? formatDayChip(group.day, locale) : t("albums.undated")}
              </h4>
              <div className={grid}>{group.assets.map((a) => tile(a, a.index))}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className={grid}>{assets.map((a, i) => tile(a, i))}</div>
      )}

      {failure && (
        <div role="alert" className="mt-2 rounded-sm border border-(--color-border) p-3 text-sm">
          <p className="text-(--danger)">{t(failure)}</p>
          {failure !== "errors.notFound" && (
            <button
              type="button"
              className="mt-2 underline"
              onClick={() =>
                void loadPage(assets.length === 0 ? 0 : (nextOffset ?? 0), generation.current)
              }
            >
              {t("errors.retry")}
            </button>
          )}
        </div>
      )}

      {loading && !failure && (
        <p role="status" className="mt-2 text-xs text-(--text-muted)">
          {t("albums.loadingDay")}
        </p>
      )}

      {nextOffset !== null && !failure && !loading && (
        <div ref={sentinel} className="mt-3 text-center">
          <button type="button" className="text-xs underline" onClick={loadMore}>
            {t("albums.loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}
