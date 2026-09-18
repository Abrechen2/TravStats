/**
 * Streaming one Immich asset to a response, once the caller's right to it is
 * settled — shared by every route that grants such a right (the album proxy,
 * the photo-journey preview, a place-visit photo that became a link).
 *
 * Moved out of `routes/immich/assetProxy.ts` unchanged when the third grant
 * arrived (forgejo#21). What differs between the routes is WHY the caller may
 * see the asset; everything after that decision must not differ at all.
 */
import type { Response } from "express";
import { pipeline } from "node:stream/promises";

import logger from "../../utils/logger";
import type { createImmichClient } from "./immichClient";

const CACHE_CONTROL = "private, max-age=86400, immutable";

/** 1x1 transparent PNG — painted instead of a broken-image icon on failure. */
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

export function sendPlaceholder(res: Response, status: number): void {
  if (res.headersSent) return;
  res.status(status);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  res.send(PLACEHOLDER_PNG);
}

/**
 * `pipeline()` rejects with `ERR_STREAM_PREMATURE_CLOSE` when the
 * *destination* (the HTTP response) closes before the source finishes —
 * exactly what happens when the client aborts the download mid-transfer.
 * That is routine browser behaviour (navigated away, cancelled a tile
 * fetch, closed the tab), not an upstream failure, so it must not be
 * logged as an error. `pipeline` already destroys both streams for us in
 * this case, closing the connection Immich was streaming over.
 */
function isClientAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ERR_STREAM_PREMATURE_CLOSE"
  );
}

/**
 * Stream one asset to the response, once the caller's right to it is settled.
 *
 * Shared by both grants below. What differs between them is WHY the caller may
 * see the asset; everything after that decision — headers, the pipeline, what a
 * client abort means, what an upstream failure paints — must not differ at all.
 */
export async function streamAsset(
  res: Response,
  client: ReturnType<typeof createImmichClient>,
  assetId: string,
  size: "thumbnail" | "preview" | "original",
  etag: string
): Promise<void> {
  const upstream = await client.fetchAssetStream(assetId, size);

  res.setHeader("Content-Type", upstream.contentType);
  res.setHeader("Cache-Control", CACHE_CONTROL);
  res.setHeader("ETag", etag);
  if (upstream.contentLength !== null) {
    res.setHeader("Content-Length", String(upstream.contentLength));
  }

  // `pipeline()` (over a bare `.pipe()`) propagates destruction in both
  // directions: if the client disconnects mid-download, `res` closes and
  // `upstream.stream` is destroyed with it, instead of holding the connection
  // to the user's Immich server open indefinitely (axios does not itself bound
  // the body transfer once streaming starts — see `fetchAssetStream`'s doc
  // comment). It also gives one place to distinguish a routine client abort
  // from a genuine upstream failure.
  try {
    await pipeline(upstream.stream, res);
  } catch (pipeError) {
    if (isClientAbort(pipeError)) return;

    logger.error({
      message: "immich_proxy_stream_error",
      error: pipeError,
      context: { assetId },
    });

    // Bytes may already be on the wire — writing a fresh status/body would
    // throw ERR_HTTP_HEADERS_SENT. Tear the connection down instead.
    if (res.headersSent) {
      res.destroy();
    } else {
      sendPlaceholder(res, 502);
    }
  }
}
