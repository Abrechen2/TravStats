import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";

import { cropLayout, isCoverCrop, type CoverCrop, type Size } from "../../lib/coverCrop";

/**
 * The trip cover as a decorative backdrop that fills its (relatively positioned)
 * parent. Without a crop it is `object-fit: cover`, centred — exactly what the
 * background-image it replaces did. With a crop it is placed by the same math
 * the editor uses (`lib/coverCrop`), measured against the parent, so the header
 * and the card — different shapes — both honour the chosen focal point and zoom.
 * Works for any URL (upload, Immich/PhotoPrism proxy, entry photo): nothing
 * server-side is derived.
 */
export default function CoverImage({
  url,
  crop,
  opacity,
}: {
  url: string;
  crop: CoverCrop | null | undefined;
  opacity: number;
}): JSX.Element {
  const holder = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Size | null>(null);
  const [image, setImage] = useState<Size | null>(null);
  const active = isCoverCrop(crop) ? crop : null;

  useEffect(() => {
    const el = holder.current;
    if (!active || !el) return;
    const measure = (): void => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setFrame({ width, height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  const layout = active && frame && image ? cropLayout(active, frame, image) : null;

  return (
    <div
      ref={holder}
      aria-hidden="true"
      className="absolute inset-0 overflow-hidden"
      style={{ opacity }}
      data-testid="cover-image"
    >
      <img
        src={url}
        alt=""
        draggable={false}
        onLoad={(e) =>
          setImage({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
        }
        className={layout ? "absolute max-w-none" : "h-full w-full object-cover"}
        style={
          layout
            ? { left: layout.left, top: layout.top, width: layout.width, height: layout.height }
            : undefined
        }
        data-cropped={layout ? "true" : "false"}
      />
    </div>
  );
}
