import { Icon } from "../ui/Icon";
import type { JSX } from "react";

/** "3✈ · 1⚓ · 2🏨 · 5📍" as line icons: what the trip map holds, at a glance. */
export function TripMapCounts({
  n: [flights, cruises, lodgings, stops],
}: {
  n: readonly [number, number, number, number];
}): JSX.Element {
  const entries = [
    [flights, "plane"],
    [cruises, "anchor"],
    [lodgings, "bed"],
    [stops, "map-pin"],
  ] as const;
  return (
    <>
      {entries.map(([count, icon], index) => (
        <span key={icon} className="inline-flex items-center gap-1">
          {index > 0 ? " · " : null}
          {count}
          <Icon name={icon} size={14} />
        </span>
      ))}
    </>
  );
}
