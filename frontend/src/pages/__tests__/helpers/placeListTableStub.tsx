import type { JSX } from "react";
import { Link } from "react-router-dom";

/**
 * The page tests drive the page's own logic (filing, reorder retry); the table itself has its
 * suite (`components/places/listTable/__tests__`). This stand-in draws the page's list entries
 * in their stored order with the page's handlers.
 */
export default function PlaceListTableStub({
  refreshKey,
  onRemove,
  onMove,
}: {
  refreshKey: unknown;
  onRemove: (placeId: string) => void;
  onMove: (placeId: string, delta: -1 | 1) => Promise<void>;
}): JSX.Element {
  const list = refreshKey as {
    entries: { id: string; placeId: string; place: { name: string } }[];
  };
  return (
    <ul>
      {list.entries.map((e) => (
        <li key={e.id}>
          <Link to={`/places/${e.placeId}`}>{e.place.name}</Link>
          <button
            type="button"
            aria-label={`„${e.place.name}“ nach oben schieben`}
            onClick={() => void onMove(e.placeId, -1)}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`„${e.place.name}“ aus der Liste entfernen`}
            onClick={() => onRemove(e.placeId)}
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
