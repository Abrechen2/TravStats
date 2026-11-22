import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { JSX, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { useTranslation } from "../../hooks/useTranslation";
import {
  COVER_FRAME_ASPECTS,
  COVER_ZOOM_MAX,
  COVER_ZOOM_MIN,
  DEFAULT_COVER_CROP,
  clampCrop,
  cropLayout,
  panCrop,
  sameCrop,
  zoomCrop,
  type CoverCrop,
  type Size,
} from "../../lib/coverCrop";
import { useDialogChrome } from "../ui/useDialogChrome";

const KEY_PAN_PX = 24;
const KEY_PAN_BIG_PX = 96;
const ZOOM_STEP = 0.25;
const WHEEL_ZOOM_PER_PX = 0.0015;
const STAGE_FILL = 0.86;

type FrameKind = keyof typeof COVER_FRAME_ASPECTS;

/**
 * Full-screen cover framing, in the manner of a chat app's photo crop: the
 * photo under a visible frame (the shape the cover is drawn in) with the
 * outside dimmed. Drag/touch pans, pinch / wheel / slider / +− zoom, arrows and
 * +/− from the keyboard, Escape cancels. The crop is `{x, y, zoom}` of
 * `lib/coverCrop` — saving it changes no pixel of the photo.
 */
export default function CoverCropEditor({
  url,
  initialCrop,
  saving,
  error,
  onSave,
  onCancel,
}: {
  url: string;
  initialCrop: CoverCrop | null;
  saving: boolean;
  /** Message of a failed save, shown in the editor and kept open. */
  error: string | null;
  /** `null` = no crop (centred). */
  onSave: (crop: CoverCrop | null) => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useTranslation("immich");
  const coarse = useCoarsePointer();
  const panelRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  const [image, setImage] = useState<Size | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [kind, setKind] = useState<FrameKind>("header");
  const [crop, setCrop] = useState<CoverCrop>(initialCrop ?? DEFAULT_COVER_CROP);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  useDialogChrome({ open: true, onClose: onCancel, panelRef, busy: saving });

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = (): void => setStage({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const aspect = COVER_FRAME_ASPECTS[kind];
  const frameWidth = Math.max(
    0,
    Math.min(stage.width * STAGE_FILL, stage.height * STAGE_FILL * aspect)
  );
  const frame: Size = { width: frameWidth, height: frameWidth / aspect };
  const ready = !!image && frame.width > 0;
  const shown = ready ? clampCrop(crop, frame, image) : crop;
  const layout = ready ? cropLayout(shown, frame, image) : null;
  const frameLeft = (stage.width - frame.width) / 2;
  const frameTop = (stage.height - frame.height) / 2;

  // A change of frame shape can leave the stored focal point outside the new range.
  useEffect(() => {
    if (image && frame.width > 0) setCrop((c) => clampCrop(c, frame, image));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-clamp only when the shape changes
  }, [kind, image, stage.width, stage.height]);

  const update = useCallback(
    (fn: (c: CoverCrop, f: Size, i: Size) => CoverCrop) => {
      if (!image || frame.width <= 0) return;
      setCrop((c) => fn(c, frame, image));
    },
    [image, frame.width, frame.height] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const zoomTo = (z: number): void => update((c, f, i) => zoomCrop(c, z, f, i));

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: shown.zoom };
    }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.dist > 0) zoomTo(pinch.current.zoom * (dist / pinch.current.dist));
    } else if (pointers.current.size === 1) {
      update((c, f, i) => panCrop(c, e.clientX - prev.x, e.clientY - prev.y, f, i));
    }
  };
  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
  };
  const onWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    zoomTo(shown.zoom * (1 - e.deltaY * WHEEL_ZOOM_PER_PX));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? KEY_PAN_BIG_PX : KEY_PAN_PX;
    const move = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    }[e.key];
    if (move) {
      e.preventDefault();
      update((c, f, i) => panCrop(c, move[0], move[1], f, i));
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomTo(shown.zoom + ZOOM_STEP);
    } else if (e.key === "-") {
      e.preventDefault();
      zoomTo(shown.zoom - ZOOM_STEP);
    }
  };

  const btn = {
    minHeight: coarse ? "var(--ts-size-touch-min)" : "36px",
    minWidth: coarse ? "var(--ts-size-touch-min)" : "36px",
    padding: "0 var(--ts-space-md)",
    borderRadius: "var(--ts-radius-button)",
    border: "1px solid var(--ts-border)",
    background: "var(--ts-surface2)",
    color: "var(--ts-text)",
  } as const;
  const placed = (l: NonNullable<typeof layout>, dx: number, dy: number) => ({
    left: l.left + dx,
    top: l.top + dy,
    width: l.width,
    height: l.height,
  });

  return (
    <div
      className="ts-dialog-scrim fixed inset-0 flex items-center justify-center"
      style={{ background: "color-mix(in srgb, black 96%, transparent)", zIndex: 80 }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("cover.crop.title")}
        tabIndex={-1}
        className="relative z-10 flex h-full w-full flex-col"
        style={{ color: "var(--ts-text)" }}
        data-testid="cover-crop-editor"
      >
        <div
          className="flex flex-wrap items-center justify-between"
          style={{ padding: "var(--ts-space-md)", gap: "var(--ts-space-sm)", color: "white" }}
        >
          <h2 className="t-h3" style={{ color: "white" }}>
            {t("cover.crop.title")}
          </h2>
          <div role="group" aria-label={t("cover.crop.frameLabel")} className="flex gap-2">
            {(Object.keys(COVER_FRAME_ASPECTS) as FrameKind[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                style={{
                  ...btn,
                  background: kind === k ? "var(--ts-accent)" : btn.background,
                  color: kind === k ? "var(--ts-accent-text)" : btn.color,
                }}
              >
                {t(`cover.crop.frame.${k}`)}
              </button>
            ))}
          </div>
        </div>

        <div
          ref={stageRef}
          className="relative min-h-0 flex-1 overflow-hidden"
          style={{ touchAction: "none", cursor: "grab", outlineOffset: -2 }}
          tabIndex={0}
          role="application"
          aria-label={t("cover.crop.stageLabel")}
          aria-describedby="cover-crop-hint"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
          data-testid="cover-crop-stage"
        >
          {/* hidden probe for natural size; also the dimmed full photo behind the frame */}
          <img
            src={url}
            alt=""
            draggable={false}
            onLoad={(e) =>
              setImage({
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              })
            }
            onError={() => setLoadFailed(true)}
            className="absolute max-w-none select-none"
            style={{
              ...(layout ? placed(layout, frameLeft, frameTop) : { opacity: 0, width: 1 }),
              filter: "brightness(0.35)",
            }}
          />
          {layout && (
            <div
              data-testid="cover-crop-frame"
              className="absolute overflow-hidden"
              style={{
                left: frameLeft,
                top: frameTop,
                width: frame.width,
                height: frame.height,
                outline: "2px solid white",
                boxShadow: "0 0 0 1px color-mix(in srgb, black 60%, transparent)",
              }}
            >
              <img
                src={url}
                alt={t("cover.crop.photoAlt")}
                draggable={false}
                className="absolute max-w-none select-none"
                style={placed(layout, 0, 0)}
                data-testid="cover-crop-image"
              />
            </div>
          )}
          {loadFailed && (
            <p
              role="alert"
              className="absolute inset-0 flex items-center justify-center text-center"
              style={{ color: "white", padding: "var(--ts-space-lg)" }}
            >
              {t("cover.crop.loadFailed")}
            </p>
          )}
        </div>

        <div
          className="flex flex-col"
          style={{ padding: "var(--ts-space-md)", gap: "var(--ts-space-sm)", color: "white" }}
        >
          <p id="cover-crop-hint" className="t-caption" style={{ color: "white" }}>
            {t("cover.crop.hint")}
          </p>
          {error && (
            <p role="alert" style={{ color: "var(--ts-bad)" }}>
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
            <button
              type="button"
              style={btn}
              aria-label={t("cover.crop.zoomOut")}
              disabled={shown.zoom <= COVER_ZOOM_MIN}
              onClick={() => zoomTo(shown.zoom - ZOOM_STEP)}
            >
              −
            </button>
            <input
              type="range"
              aria-label={t("cover.crop.zoom")}
              min={COVER_ZOOM_MIN}
              max={COVER_ZOOM_MAX}
              step={0.01}
              value={shown.zoom}
              onChange={(e) => zoomTo(Number(e.target.value))}
              style={{ flex: "1 1 160px", minHeight: coarse ? "var(--ts-size-touch-min)" : "24px" }}
            />
            <button
              type="button"
              style={btn}
              aria-label={t("cover.crop.zoomIn")}
              disabled={shown.zoom >= COVER_ZOOM_MAX}
              onClick={() => zoomTo(shown.zoom + ZOOM_STEP)}
            >
              +
            </button>
            <button type="button" style={btn} onClick={() => setCrop(DEFAULT_COVER_CROP)}>
              {t("cover.crop.reset")}
            </button>
            <span className="flex-1" />
            <button type="button" style={btn} onClick={onCancel} disabled={saving}>
              {t("cover.crop.cancel")}
            </button>
            <button
              type="button"
              style={{ ...btn, background: "var(--ts-accent)", color: "var(--ts-accent-text)" }}
              disabled={saving || !ready}
              onClick={() => onSave(sameCrop(shown, null) ? null : shown)}
            >
              {saving ? t("cover.crop.saving") : t("cover.crop.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
