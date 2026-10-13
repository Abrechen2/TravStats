import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { prisma } from "../../../db";
import {
  getTripPhotoDir,
  getPlacePhotoDir,
  getLodgingPhotoDir,
  getUploadDir,
} from "../../../middleware/upload";
import { getNotePhotoDir } from "../../../middleware/notePhotoUpload";
import { documentPath } from "../../documents/documentStore";
import { getImmichConnection } from "../../immich/immichResolver";
import { createImmichClient } from "../../immich/immichClient";
import { refused } from "../security";
export interface AssetRef {
  key: string;
  kind: string;
  id: string;
  name: string;
  mime: string;
  size: number | null;
  assetId?: string;
}
async function localFile(dir: string, filename: string) {
  if (path.basename(filename) !== filename) throw refused();
  const realDir = await fsp.realpath(dir),
    file = await fsp.realpath(path.join(dir, filename));
  if (path.dirname(file) !== realDir) throw refused();
  const stat = await fsp.stat(file);
  if (!stat.isFile()) throw refused();
  return { stream: fs.createReadStream(file), size: stat.size };
}
export async function immichFor(userId: string) {
  const connection = await getImmichConnection(userId);
  if (!connection) throw refused();
  return createImmichClient(connection);
}
async function remoteAsset(userId: string, assetId: string) {
  const asset = await (await immichFor(userId)).fetchAssetStream(assetId, "original");
  return { stream: asset.stream as Readable, size: asset.contentLength };
}
/** Only owner-authorised DB identifiers. No caller-supplied path, URL, or Immich credential. */
export async function ownerAsset(
  userId: string,
  kind: string,
  id: string,
  assetId?: string
): Promise<{ stream: Readable; size: number | null }> {
  if (kind === "trip") {
    const p = await prisma.tripPhoto.findFirst({ where: { id, trip: { userId } } });
    if (!p) throw refused();
    return p.immichAssetId && !p.filename
      ? remoteAsset(userId, p.immichAssetId)
      : localFile(getTripPhotoDir(), p.filename);
  }
  if (kind === "visit") {
    const p = await prisma.placeVisitPhoto.findFirst({ where: { id, visit: { userId } } });
    if (!p) throw refused();
    if (p.tripPhotoId) return ownerAsset(userId, "trip", p.tripPhotoId);
    return p.filename
      ? localFile(getPlacePhotoDir(), p.filename)
      : p.immichAssetId
        ? remoteAsset(userId, p.immichAssetId)
        : Promise.reject(refused());
  }
  if (kind === "lodging") {
    const p = await prisma.lodgingPhoto.findFirst({ where: { id, lodging: { userId } } });
    if (!p) throw refused();
    return localFile(getLodgingPhotoDir(), p.filename);
  }
  if (kind === "note") {
    const n = await prisma.note.findFirst({ where: { id, userId } });
    if (!n?.photoFilename) throw refused();
    return localFile(getNotePhotoDir(), n.photoFilename);
  }
  if (kind === "document") {
    const d = await prisma.document.findFirst({ where: { id, userId } });
    if (!d) throw refused();
    const file = documentPath(d.storedName);
    return localFile(path.dirname(file), path.basename(file));
  }
  if (kind === "receipt") {
    const r = await prisma.receiptUpload.findFirst({ where: { id, userId } });
    if (!r) throw refused();
    return localFile(getUploadDir(), r.filename);
  }
  if (kind === "album" && assetId) {
    const album = await prisma.tripImmichAlbum.findFirst({ where: { id, trip: { userId } } });
    if (!album) throw refused();
    const client = await immichFor(userId),
      assets = await client.listAlbumAssets(album.immichAlbumId);
    if (!assets.some((a) => a.id === assetId)) throw refused();
    return remoteAsset(userId, assetId);
  }
  throw refused();
}
export async function rowAssets(
  userId: string,
  model: string,
  row: Record<string, unknown>
): Promise<AssetRef[]> {
  const kinds: Record<string, string> = {
    TripPhoto: "trip",
    PlaceVisitPhoto: "visit",
    LodgingPhoto: "lodging",
    Note: "note",
    Document: "document",
    ReceiptUpload: "receipt",
  };
  if (model === "TripImmichAlbum" && row.mode === "link") {
    const files = await (await immichFor(userId)).listAlbumAssets(String(row.immichAlbumId));
    if (files.length >= 50000) throw refused();
    return files.map((f) => ({
      key: `album:${row.id}:${f.id}`,
      kind: "album",
      id: String(row.id),
      assetId: f.id,
      name: f.originalFileName,
      mime: f.mimeType,
      size: f.sizeBytes,
    }));
  }
  const kind = kinds[model];
  if (!kind || (model === "Note" && !row.photoFilename)) return [];
  return [
    {
      key: `${kind}:${row.id}`,
      kind,
      id: String(row.id),
      name: String(row.originalName ?? row.filename ?? row.photoFilename ?? `${kind}-${row.id}`),
      mime: String(row.mimetype ?? row.photoMimetype ?? "application/octet-stream"),
      size:
        typeof row.sizeBytes === "number"
          ? row.sizeBytes
          : typeof row.photoSizeBytes === "number"
            ? row.photoSizeBytes
            : null,
    },
  ];
}
