import { useCallback, useEffect, useState, type JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { formatLocalDate } from "../../../lib/format";
import { failureKey } from "../../../lib/api/immich";
import { logger } from "../../../lib/logger";
import {
  tripPhotoSourcesApi,
  type LinkedPhotoFailure,
  type LinkedPhotoPage,
  type TripPhotoProposals,
  type TripPhotoSource,
} from "../../../lib/api/tripPhotoSources";
import type { PhotoSourceKind } from "../../../types/immich";
import EnlargeButton from "../../common/photoViewer/EnlargeButton";
import { usePhotoViewer } from "../../common/photoViewer/usePhotoViewer";
import { largeUrl, type ViewerPhoto } from "../../common/photoViewer/viewerPhoto";
import { Button, Card } from "../../ui";
import LinkedPhotoGallery from "./LinkedPhotoGallery";
import InlineError from "../../ui/InlineError";
import Banner from "../../ui/Banner";

/** Thumbnails on the card; everything else is one click away in the gallery. */
export const CARD_THUMBS = 4;
const TILE = 96;
const REFUSALS = ["notConfigured", "notPreferred", "noDates", "importedAlbum", "unknownAlbum"];

const errorOf = (err: unknown): unknown =>
  (err as { response?: { data?: { error?: unknown } } } | null)?.response?.data?.error;

/**
 * The trip's "Fotos" card (spec 2026-11-26-trip-photo-links.md): 3–4 thumbnails of every linked
 * source plus "+N weitere" into the day-grouped gallery, the album proposals and the business
 * offer as one-line hints (never the inbox), and the sources with a remove button. Every
 * failure — a source that is down, a refused click — is said on the card.
 */
export default function TripPhotosCard({ tripId }: { tripId: string }): JSX.Element | null {
  const { t } = useTranslation(["trips", "immich"]);
  const [page, setPage] = useState<LinkedPhotoPage | null>(null);
  const [proposals, setProposals] = useState<TripPhotoProposals | null>(null);
  const [sources, setSources] = useState<TripPhotoSource[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const viewer = usePhotoViewer();

  const load = useCallback(async (): Promise<void> => {
    const [photos, proposalRes, list] = await Promise.allSettled([
      tripPhotoSourcesApi.photos(tripId, { limit: CARD_THUMBS }),
      tripPhotoSourcesApi.proposals(tripId),
      tripPhotoSourcesApi.list(tripId),
    ]);
    if (photos.status === "fulfilled") setPage(photos.value);
    if (proposalRes.status === "fulfilled") setProposals(proposalRes.value);
    if (list.status === "fulfilled") setSources(list.value);
    const failed = [photos, proposalRes, list].filter((r) => r.status === "rejected");
    for (const r of failed)
      logger.error("TripPhotosCard: load failed", (r as PromiseRejectedResult).reason);
    setLoadFailed(failed.length > 0);
  }, [tripId]);
  useEffect(() => void load(), [load]);

  const providerName = (p: PhotoSourceKind): string => t(`trips:photoLinks.provider.${p}`);
  const failureText = (provider: PhotoSourceKind, kind: unknown): string =>
    kind === "notConfigured"
      ? t(
          provider === "photoprism"
            ? "immich:errors.photoprism.notConfigured"
            : "immich:errors.notConfigured"
        )
      : t(`immich:${failureKey(kind, provider)}`);

  const act = async (key: string, work: () => Promise<unknown>): Promise<void> => {
    setBusy(key);
    setActionError(null);
    try {
      await work();
      await load();
    } catch (err: unknown) {
      logger.error("TripPhotosCard: action failed", err);
      const kind = errorOf(err);
      const reason =
        typeof kind === "string" && REFUSALS.includes(kind)
          ? t(`trips:photoLinks.refusal.${kind}`)
          : typeof kind === "string"
            ? failureText(proposals?.connectionId ?? "photoprism", kind)
            : t("trips:photoLinks.refusal.unknown");
      setActionError(t("trips:photoLinks.actionFailed", { reason }));
    } finally {
      setBusy(null);
    }
  };

  const nothingToShow =
    !loadFailed &&
    page !== null &&
    proposals !== null &&
    proposals.connectionId === null &&
    sources.length === 0 &&
    page.totalAll === 0 &&
    page.failures.length === 0;
  if (nothingToShow) return null;

  const sourceLabel = (s: {
    provider: PhotoSourceKind;
    sourceId?: string;
    id?: string;
  }): string => {
    const found = sources.find((x) => x.id === (s.sourceId ?? s.id));
    if (found?.kind === "album") {
      return `${providerName(found.provider)} · ${t("trips:photoLinks.sourceAlbum", { name: found.name ?? "" })}`;
    }
    if (found?.kind === "period" && found.from && found.until) {
      return `${providerName(found.provider)} · ${t("trips:photoLinks.sourcePeriod", {
        from: formatLocalDate(found.from),
        until: formatLocalDate(found.until),
      })}`;
    }
    return providerName(s.provider);
  };

  const thumbs = page?.photos.slice(0, CARD_THUMBS) ?? [];
  const more = page ? page.totalAll - thumbs.length : 0;
  const toViewer = (p: LinkedPhotoPage["photos"][number]): ViewerPhoto => ({
    id: p.key,
    url: largeUrl(p.previewUrl),
    takenAt: p.takenAt,
    source: p.provider,
  });
  const offer = proposals?.periodOffer ?? null;

  return (
    <Card className="mt-6" data-testid="trip-photos-card">
      <h2 className="t-card-title">{t("trips:photoLinks.title")}</h2>

      {loadFailed && (
        <Banner
          tone="error"
          action={
            <Button variant="secondary" onClick={() => void load()}>
              {t("trips:photoLinks.retry")}
            </Button>
          }
        >
          {t("trips:photoLinks.loadFailed")}
        </Banner>
      )}
      {page === null && !loadFailed && <p className="t-caption">{t("trips:photoLinks.loading")}</p>}

      {page?.failures.map((f: LinkedPhotoFailure) => (
        <InlineError key={f.sourceId}>
          {t("trips:photoLinks.sourceFailed", {
            source: sourceLabel(f),
            reason: failureText(f.provider, f.kind),
          })}
        </InlineError>
      ))}
      {page?.truncated && <p className="t-caption">{t("trips:photoLinks.truncated")}</p>}

      {page !== null && page.totalAll === 0 && (
        <p className="t-caption">{t("trips:photoLinks.empty")}</p>
      )}
      {thumbs.length > 0 && (
        <ul className="flex flex-wrap gap-2 mt-2" data-testid="trip-photos-thumbs">
          {thumbs.map((p, index) => (
            <li key={p.key} style={{ width: TILE }}>
              <EnlargeButton onOpen={() => viewer.open(thumbs.map(toViewer), index)}>
                <img
                  src={p.url}
                  alt={t("trips:photoLinks.gallery.alt")}
                  loading="lazy"
                  style={{ width: TILE, height: TILE, objectFit: "cover", borderRadius: 6 }}
                />
              </EnlargeButton>
            </li>
          ))}
          {more > 0 && (
            <li>
              <Button
                variant="secondary"
                onClick={() => setGalleryOpen(true)}
                style={{ height: TILE, minWidth: TILE }}
                aria-label={t("trips:photoLinks.showAll")}
              >
                {t("trips:photoLinks.more", { count: more })}
              </Button>
            </li>
          )}
        </ul>
      )}

      {proposals?.failure && (
        <InlineError className="mt-2">
          {t("trips:photoLinks.proposalFailed", {
            reason: failureText(proposals.connectionId ?? "photoprism", proposals.failure),
          })}
        </InlineError>
      )}
      {proposals?.proposals.map((p) => (
        <div
          key={p.key}
          className="flex flex-wrap items-center gap-2 mt-2"
          data-testid="photo-proposal"
        >
          <span>
            {t("trips:photoLinks.proposal", { name: p.name })}{" "}
            {p.count !== null && t("trips:photoLinks.proposalCount", { count: p.count })}{" "}
            <span className="t-caption">· {t(`trips:photoLinks.proposalReason.${p.reason}`)}</span>
          </span>
          <Button
            variant="primary"
            disabled={busy !== null}
            onClick={() =>
              void act(p.key, () => tripPhotoSourcesApi.addAlbum(tripId, p.connectionId, p.albumId))
            }
          >
            {t("trips:photoLinks.link")}
          </Button>
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void act(p.key, () => tripPhotoSourcesApi.dismiss(tripId, p.key))}
          >
            {t("trips:photoLinks.notThis")}
          </Button>
        </div>
      ))}
      {offer && (
        <div className="flex flex-wrap items-center gap-2 mt-2" data-testid="period-offer">
          <span>
            {t("trips:photoLinks.periodOffer", {
              provider: providerName(offer.connectionId),
              from: formatLocalDate(offer.from),
              until: formatLocalDate(offer.until),
            })}
          </span>
          <Button
            variant="primary"
            disabled={busy !== null}
            onClick={() => void act("period", () => tripPhotoSourcesApi.addPeriod(tripId))}
          >
            {t("trips:photoLinks.linkPeriod")}
          </Button>
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void act("period", () => tripPhotoSourcesApi.dismiss(tripId, "period"))}
          >
            {t("trips:photoLinks.notNow")}
          </Button>
        </div>
      )}
      {proposals?.autoLinked && (
        <p className="t-caption mt-2">{t("trips:photoLinks.autoLinked")}</p>
      )}

      {sources.length > 0 && (
        <div className="mt-4">
          <h3 className="label">{t("trips:photoLinks.sources")}</h3>
          <ul className="flex flex-col gap-1" data-testid="photo-sources">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span className="t-caption">{sourceLabel(s)}</span>
                {s.mode === "import" ? (
                  <span className="t-caption">{t("trips:photoLinks.removeImported")}</span>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => void act(s.id, () => tripPhotoSourcesApi.remove(tripId, s.id))}
                  >
                    {t("trips:photoLinks.remove")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {actionError && <InlineError className="mt-2">{actionError}</InlineError>}
      {galleryOpen && page && (
        <LinkedPhotoGallery
          tripId={tripId}
          days={page.days}
          onClose={() => setGalleryOpen(false)}
        />
      )}
      {viewer.viewer}
    </Card>
  );
}
