import fsp from "fs/promises";
import path from "path";

import logger from "../../utils/logger";
import { ImmichError } from "../immich/types";
import { createPhotoSource } from "../photoSource";
import { getPhotoSourceConnection, toPhotoSourceKind } from "../photoSource/connection";
import type { PhotoSourceKind, PhotoSourceProvider } from "../photoSource/types";
import { displayRenditionName, isHeifMimetype } from "../photos/displayRendition";
import { downscaleToJpeg, MAX_DECODE_BYTES } from "./downscale";

/** Longest edge of an embedded photograph, in pixels. */
export const BOOK_PHOTO_EDGE = 900;

/**
 * Turns stored or linked photographs into embeddable `data:` URIs. Every
 * failure is counted in `skipped` (and logged), never swallowed: the job's
 * result tells the user how many photographs the book is missing.
 */
export class PhotoLoader {
  skipped = 0;
  private readonly sources = new Map<PhotoSourceKind, PhotoSourceProvider | null>();

  constructor(private readonly userId: string) {}

  private toUri(bytes: Buffer, mimetype: string): string | null {
    const small = downscaleToJpeg(bytes, mimetype, BOOK_PHOTO_EDGE);
    if (!small) return null;
    return `data:${small.mimetype};base64,${small.data.toString("base64")}`;
  }

  /** A copy on this server's disk (`dir/filename`); a HEIC original reads through its JPEG display copy. */
  async fromDisk(dir: string, filename: string, mimetype: string): Promise<string | null> {
    const name = isHeifMimetype(mimetype)
      ? displayRenditionName(filename)
      : path.basename(filename);
    try {
      const bytes = await fsp.readFile(path.join(dir, path.basename(name)));
      const uri = this.toUri(bytes, isHeifMimetype(mimetype) ? "image/jpeg" : mimetype);
      if (!uri) this.skip("undecodable", filename);
      return uri;
    } catch (err) {
      this.skip(err instanceof Error ? err.message : "read failed", filename);
      return null;
    }
  }

  private async source(provider: PhotoSourceKind): Promise<PhotoSourceProvider | null> {
    if (this.sources.has(provider)) return this.sources.get(provider) ?? null;
    const conn = await getPhotoSourceConnection(provider, this.userId);
    const source = conn ? createPhotoSource(provider, conn) : null;
    this.sources.set(provider, source);
    return source;
  }

  /**
   * A photograph that only lives in the owner's Immich/PhotoPrism: fetched with
   * the owner's own connection (the one the asset proxy uses, with its egress
   * rules), as the library's own preview rendition.
   */
  async fromLibrary(providerValue: string, assetId: string): Promise<string | null> {
    const provider = toPhotoSourceKind(providerValue);
    try {
      const source = await this.source(provider);
      if (!source) {
        this.skip("notConfigured", assetId);
        return null;
      }
      const upstream = await source.streamThumbnail(assetId, "preview");
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of upstream.stream as AsyncIterable<Buffer | string>) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > MAX_DECODE_BYTES) {
          this.skip("tooLarge", assetId);
          return null;
        }
        chunks.push(buf);
      }
      const uri = this.toUri(Buffer.concat(chunks), upstream.contentType);
      if (!uri) this.skip("undecodable", assetId);
      return uri;
    } catch (err) {
      this.skip(err instanceof ImmichError ? err.kind : "failed", assetId);
      return null;
    }
  }

  private skip(reason: string, ref: string): void {
    this.skipped++;
    logger.warn({ operation: "life_book_photo_skipped", reason, ref });
  }
}
