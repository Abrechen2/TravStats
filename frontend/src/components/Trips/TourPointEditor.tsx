import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import type { TourPointInput } from "../../lib/api/tours";

interface TourPointEditorProps {
  points: TourPointInput[];
  saving: boolean;
  onSave: (points: TourPointInput[]) => void;
}

/**
 * The point list of a tour that belongs to no trip.
 *
 * A section of a TRIP picks its vertices from that trip's timeline
 * (`TourStopAssigner`). A standalone tour has no timeline to pick from, so
 * its points are typed here — a name and a coordinate each, in the order
 * they are travelled.
 *
 * Everything is edited locally and written in ONE call: the endpoint
 * replaces the whole list (added, moved, removed, renumbered) in a single
 * transaction, and saving per row would make a half-edited tour a state
 * the server can be left in. An existing point keeps its `id` across a
 * reorder, which is what lets its legs survive — legs are keyed by their
 * endpoint stops, never by position.
 */
export default function TourPointEditor({
  points,
  saving,
  onSave,
}: TourPointEditorProps): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  const [draft, setDraft] = useState<TourPointInput[]>(points);

  const update = (index: number, patch: Partial<TourPointInput>): void => {
    setDraft((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const move = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    setDraft((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  // A point with no coordinate produces no leg and no kilometre, and the
  // server refuses it — so the form refuses it first, rather than letting
  // the reader type a whole list and meet one error for all of it.
  const incomplete = draft.some(
    (p) => p.title.trim() === "" || !isFinite(p.lat) || !isFinite(p.lon)
  );

  return (
    <div className="space-y-2">
      {draft.length === 0 && (
        <p className="text-sm text-(--text-muted)">{t("trips:tours.points.empty")}</p>
      )}

      <ul className="space-y-2">
        {draft.map((point, index) => (
          <li
            key={point.id ?? `new-${index}`}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-(--color-border) p-2"
          >
            <span className="w-6 text-center text-xs text-(--text-muted)">{index + 1}</span>
            <input
              type="text"
              value={point.title}
              onChange={(e) => update(index, { title: e.target.value })}
              placeholder={t("trips:tours.points.titlePlaceholder")}
              aria-label={t("trips:tours.points.titlePlaceholder")}
              className="min-w-40 flex-1 rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-sm"
            />
            <input
              type="number"
              step="any"
              value={Number.isFinite(point.lat) ? point.lat : ""}
              onChange={(e) => update(index, { lat: Number(e.target.value) })}
              aria-label={t("trips:tours.points.lat")}
              className="w-28 rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-sm"
            />
            <input
              type="number"
              step="any"
              value={Number.isFinite(point.lon) ? point.lon : ""}
              onChange={(e) => update(index, { lon: Number(e.target.value) })}
              aria-label={t("trips:tours.points.lon")}
              className="w-28 rounded-sm border border-(--color-border) bg-transparent px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={() => move(index, -1)}
              disabled={index === 0}
              aria-label={t("trips:tours.points.moveUp")}
              className="px-1 text-sm disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(index, 1)}
              disabled={index === draft.length - 1}
              aria-label={t("trips:tours.points.moveDown")}
              className="px-1 text-sm disabled:opacity-30"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))}
              className="text-xs underline"
            >
              {t("trips:tours.points.remove")}
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setDraft((prev) => [...prev, { title: "", lat: NaN, lon: NaN }])}
          className="rounded-sm border border-(--color-border) px-3 py-1.5 text-sm hover:bg-(--bg-surface)"
        >
          {t("trips:tours.points.add")}
        </button>
        <button
          type="button"
          disabled={saving || incomplete}
          onClick={() => onSave(draft)}
          className="rounded-sm bg-(--accent) px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {t("trips:tours.points.save")}
        </button>
        {incomplete && (
          <span className="text-xs" style={{ color: "var(--warning)" }}>
            {t("trips:tours.points.incomplete")}
          </span>
        )}
      </div>
    </div>
  );
}
