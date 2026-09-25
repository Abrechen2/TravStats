import type { JSX } from "react";

import { Icon } from "../ui/Icon";
import type { StationState } from "../../shared/tour/roadtrip";

/**
 * A station's state as a shape, never as a colour alone (design 2026-09-25,
 * board 0): a stay is a square with a bed, a free night a disc with a moon, a
 * pass-through an empty ring. The word beside it says the same thing for a
 * screen reader, so the marker itself is decoration.
 *
 * A cancelled stay keeps its square but loses its fill — the link is still
 * there, the night is not.
 */
export default function StationMarker({
  state,
  size = "md",
  cancelled = false,
  selected = false,
}: {
  state: StationState;
  size?: "sm" | "md";
  cancelled?: boolean;
  selected?: boolean;
}): JSX.Element {
  const box = size === "sm" ? 18 : 22;
  const ring = selected ? "0 0 0 2px var(--ts-bg), 0 0 0 4px var(--ts-text-bright)" : undefined;

  if (state === "pass") {
    const d = size === "sm" ? 10 : 14;
    return (
      <span
        aria-hidden
        className="flex items-center justify-center"
        style={{ width: box, height: box }}
      >
        <span
          style={{
            width: d,
            height: d,
            borderRadius: 999,
            border: "2px solid var(--ts-muted)",
            background: "var(--ts-bg)",
            boxShadow: ring,
          }}
        />
      </span>
    );
  }

  const isStay = state === "stay";
  const hue = isStay ? "var(--domain-lodging)" : "var(--domain-roadtrip)";
  return (
    <span
      aria-hidden
      className="flex items-center justify-center"
      style={{
        width: box,
        height: box,
        flexShrink: 0,
        borderRadius: isStay ? 6 : 999,
        background: cancelled ? "transparent" : hue,
        border: cancelled ? `2px dashed ${hue}` : undefined,
        color: cancelled ? hue : "var(--ts-bg)",
        boxShadow: ring,
      }}
    >
      <Icon name={isStay ? "bed" : "moon"} size={14} />
    </span>
  );
}
