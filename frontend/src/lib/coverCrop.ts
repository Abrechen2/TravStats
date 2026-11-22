/**
 * Cover crop math (owner, 2026-11-22). One model for the editor and for every
 * place a cover renders, so what the editor shows is what the header and the
 * card draw.
 *
 * A crop is `{x, y, zoom}`: x/y are the point of the image (0..1 of its width /
 * height) that sits in the MIDDLE of the frame, zoom >= 1 multiplies the
 * "cover fit" (the smallest scale that still fills the frame). It is
 * resolution-independent and frame-independent, which is the point: the header
 * and the trip card have different aspect ratios and both show the same
 * focal point. The frame is always filled — `clampCrop` pulls x/y back inside
 * the range where no empty edge shows. Mirrors the server's range check in
 * `backend/src/schemas/trip.ts` (`coverCropSchema`).
 */
export interface CoverCrop {
  x: number;
  y: number;
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Placement of the whole image inside the frame, in frame pixels. */
export interface CoverLayout {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const COVER_ZOOM_MIN = 1;
export const COVER_ZOOM_MAX = 8;
export const DEFAULT_COVER_CROP: CoverCrop = { x: 0.5, y: 0.5, zoom: 1 };

/** The two shapes a cover is drawn in (trip header, trip-list card). */
export const COVER_FRAME_ASPECTS = { header: 6, card: 3.4 } as const;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function isCoverCrop(v: unknown): v is CoverCrop {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return [c.x, c.y, c.zoom].every((n) => typeof n === "number" && Number.isFinite(n));
}

function renderedSize(frame: Size, image: Size, zoom: number): Size {
  const scale = Math.max(frame.width / image.width, frame.height / image.height) * zoom;
  return { width: image.width * scale, height: image.height * scale };
}

/** Pulls zoom into range and x/y to where the frame stays completely filled. */
export function clampCrop(crop: CoverCrop, frame: Size, image: Size): CoverCrop {
  const zoom = clamp(crop.zoom, COVER_ZOOM_MIN, COVER_ZOOM_MAX);
  const r = renderedSize(frame, image, zoom);
  const halfX = frame.width / 2 / r.width;
  const halfY = frame.height / 2 / r.height;
  return { zoom, x: clamp(crop.x, halfX, 1 - halfX), y: clamp(crop.y, halfY, 1 - halfY) };
}

export function cropLayout(crop: CoverCrop | null, frame: Size, image: Size): CoverLayout {
  const c = clampCrop(crop ?? DEFAULT_COVER_CROP, frame, image);
  const r = renderedSize(frame, image, c.zoom);
  return {
    width: r.width,
    height: r.height,
    left: frame.width / 2 - c.x * r.width,
    top: frame.height / 2 - c.y * r.height,
  };
}

/** Drag the picture by (dx, dy) frame pixels: the focal point moves the other way. */
export function panCrop(
  crop: CoverCrop,
  dx: number,
  dy: number,
  frame: Size,
  image: Size
): CoverCrop {
  const r = renderedSize(frame, image, clampCrop(crop, frame, image).zoom);
  return clampCrop({ ...crop, x: crop.x - dx / r.width, y: crop.y - dy / r.height }, frame, image);
}

/** Zoom about the frame centre; the focal point stays, the clamp keeps the frame filled. */
export function zoomCrop(crop: CoverCrop, zoom: number, frame: Size, image: Size): CoverCrop {
  return clampCrop({ ...crop, zoom }, frame, image);
}

export function sameCrop(a: CoverCrop | null, b: CoverCrop | null): boolean {
  const x = a ?? DEFAULT_COVER_CROP;
  const y = b ?? DEFAULT_COVER_CROP;
  const eq = (p: number, q: number): boolean => Math.abs(p - q) < 1e-4;
  return eq(x.x, y.x) && eq(x.y, y.y) && eq(x.zoom, y.zoom);
}
