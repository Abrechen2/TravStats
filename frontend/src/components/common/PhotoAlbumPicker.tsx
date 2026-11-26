import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { failureKey, immichFailureKind } from "../../lib/api/immich";
import {
  listPhotoAlbums,
  type ChoiceProvider,
  type ChoiceTarget,
  type PhotoAlbum,
} from "../../lib/api/photoChoices";
import { logger } from "../../lib/logger";
import InlineError from "../ui/InlineError";

const PROVIDERS: ChoiceProvider[] = ["immich", "photoprism"];

interface Props {
  target: Extract<ChoiceTarget, { type: "entry" }>;
  onPick: (provider: ChoiceProvider, album: PhotoAlbum) => void;
  onCancel: () => void;
  /** The 44 px target size of a coarse pointer. */
  minSize: number;
}

type Listing =
  | { state: "loading" }
  | { state: "ok"; albums: PhotoAlbum[] }
  | { state: "notConfigured" }
  | { state: "failed"; message: string };

/**
 * "Aus Album wählen": the albums and folders of every connected photo source, the same listing
 * the trip gallery reads. Picking one only narrows the candidates — nothing is linked here.
 */
export function PhotoAlbumPicker({ target, onPick, onCancel, minSize }: Props): JSX.Element {
  const { t } = useTranslation(["common", "immich"]);
  const [listings, setListings] = useState<Record<ChoiceProvider, Listing>>({
    immich: { state: "loading" },
    photoprism: { state: "loading" },
  });
  const [filter, setFilter] = useState("");
  const { kind, entryId } = target;

  useEffect(() => {
    let live = true;
    for (const provider of PROVIDERS) {
      listPhotoAlbums({ type: "entry", kind, entryId }, provider)
        .then(
          (albums) =>
            live && setListings((prev) => ({ ...prev, [provider]: { state: "ok", albums } }))
        )
        .catch((err: unknown) => {
          if (!live) return;
          const failure = immichFailureKind(err);
          if (failure === "notConfigured") {
            setListings((prev) => ({ ...prev, [provider]: { state: "notConfigured" } }));
            return;
          }
          logger.error("PhotoAlbumPicker: listing failed", err);
          setListings((prev) => ({
            ...prev,
            [provider]: { state: "failed", message: t(`immich:${failureKey(failure, provider)}`) },
          }));
        });
    }
    return () => {
      live = false;
    };
  }, [kind, entryId, t]);

  const shown = PROVIDERS.filter((p) => listings[p].state !== "notConfigured");
  const needle = filter.trim().toLowerCase();

  return (
    <section
      aria-label={t("common:photoChoose.album.title")}
      data-testid="photo-album-picker"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="t-label">{t("common:photoChoose.album.title")}</h3>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 text-xs font-medium"
          style={{ minHeight: minSize, border: "1px solid var(--color-border)" }}
        >
          {t("common:photoChoose.album.back")}
        </button>
      </div>
      <p className="t-caption">{t("common:photoChoose.album.hint")}</p>
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label={t("common:photoChoose.album.filter")}
        placeholder={t("common:photoChoose.album.filter")}
        className="rounded-md px-3 text-sm"
        style={{ minHeight: minSize, border: "1px solid var(--color-border)", background: "none" }}
      />
      {shown.length === 0 && <p className="t-caption">{t("common:photoChoose.album.noSource")}</p>}
      {shown.map((provider) => {
        const listing = listings[provider];
        return (
          <div key={provider} className="flex flex-col gap-1">
            <h4 className="t-label">{t(`common:entryPhotos.source.${provider}`)}</h4>
            {listing.state === "loading" && (
              <p className="t-caption">{t("common:photoChoose.album.loading")}</p>
            )}
            {listing.state === "failed" && <InlineError>{listing.message}</InlineError>}
            {listing.state === "ok" && listing.albums.length === 0 && (
              <p className="t-caption">{t("common:photoChoose.album.none")}</p>
            )}
            {listing.state === "ok" && (
              <ul className="flex flex-col gap-1">
                {listing.albums
                  .filter((a) => needle === "" || a.albumName.toLowerCase().includes(needle))
                  .map((album) => (
                    <li key={album.id}>
                      <button
                        type="button"
                        onClick={() => onPick(provider, album)}
                        data-testid={`photo-album-${provider}-${album.id}`}
                        className="flex w-full items-center justify-between gap-3 rounded-md px-3 text-left text-sm"
                        style={{ minHeight: minSize, border: "1px solid var(--color-border)" }}
                      >
                        <span>{album.albumName}</span>
                        <span className="t-caption">
                          {t("common:photoChoose.album.count", { count: album.assetCount })}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}

export default PhotoAlbumPicker;
