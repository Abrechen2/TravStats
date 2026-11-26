/** Where a photo comes from, as the caption names it. */
export type ViewerPhotoSource = "upload" | "immich" | "photoprism";

/** One photo as the shared viewer shows it — every surface maps its own rows onto this. */
export interface ViewerPhoto {
  id: string;
  /** The picture itself: the original or a large preview, proxied or local. */
  url: string;
  caption?: string | null;
  /** ISO instant; the caption prints it in the display format. */
  takenAt?: string | null;
  place?: string | null;
  source?: ViewerPhotoSource | null;
  /** The entry the photo belongs to (a stay, a station, a visit). */
  entry?: { href: string; label: string } | null;
}

/** Proxy routes that take a `size` — the lightbox asks them for the large preview. */
const SIZED_PROXY =
  /\/(entry-photos|photo-journeys|immich\/albums|photo-suggestions|photo-sources)\b/;

/**
 * The large rendition of a thumbnail URL. Library photos stream through a proxy that
 * serves `?size=thumbnail|preview|original`; uploads and every other URL are already the
 * picture and pass through unchanged. Nothing is downloaded extra — the proxy streams.
 */
export function largeUrl(url: string, size: "preview" | "original" = "preview"): string {
  if (!SIZED_PROXY.test(url)) return url;
  const [path, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  params.set("size", size);
  return `${path}?${params.toString()}`;
}

/** Map an `immich`/`photoprism` provider string to the caption's source. */
export function sourceOf(provider: string | null | undefined): ViewerPhotoSource {
  return provider === "photoprism" ? "photoprism" : provider === "immich" ? "immich" : "upload";
}
