import type { ImmichConnection } from "../immich/types";
import { createImmichPhotoSource } from "./immichSource";
import { createPhotoprismPhotoSource } from "./photoprismSource";
import type { PhotoSourceAsset, PhotoSourceKind, PhotoSourceProvider } from "./types";

export type { PhotoSourceKind, PhotoSourceProvider } from "./types";
export { PHOTO_SOURCE_KINDS } from "./types";

/** Hard stop for `listAllAlbumAssets`, so a source that never ends cannot loop forever. */
const MAX_PAGES = 200;

/** An album's assets; `truncated` rides on the array so the listing cache hands it on unchanged. */
export type AlbumAssetList = PhotoSourceAsset[] & { truncated?: boolean };

export function createPhotoSource(
  kind: PhotoSourceKind,
  connection: ImmichConnection
): PhotoSourceProvider {
  switch (kind) {
    case "immich":
      return createImmichPhotoSource(connection);
    case "photoprism":
      return createPhotoprismPhotoSource(connection);
  }
}

/** Every asset of an album, following `nextPage`; a failing page fails the whole call. */
export async function listAllAlbumAssets(
  source: Pick<PhotoSourceProvider, "listAlbumAssets">,
  albumId: string
): Promise<AlbumAssetList> {
  const collected: AlbumAssetList = [];
  let truncated = false;
  let page: number | null = 0;
  for (let n = 0; page !== null && n < MAX_PAGES; n += 1) {
    const result = await source.listAlbumAssets(albumId, page);
    collected.push(...result.assets);
    truncated = truncated || result.truncated;
    page = result.nextPage;
  }
  if (page !== null) truncated = true;
  if (truncated) collected.truncated = true;
  return collected;
}
