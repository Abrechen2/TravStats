import { formatDayLabel } from "../../lib/format";
import { useEffect, useRef } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useLocale } from "../../hooks/useLocale";
import type { AlbumDayCount } from "../../types/immich";

export const ALL_DAYS = "all";
export const UNDATED_DAY = "undated";

/** The bucket key the server uses for a day entry. */
export const dayKey = (d: AlbumDayCount): string => d.day ?? UNDATED_DAY;

interface Props {
  days: readonly AlbumDayCount[];
  total: number;
  selected: string;
  onSelect: (key: string) => void;
}

/** `YYYY-MM-DD` key read in UTC so the reader's zone cannot move it. */
export function formatDayChip(day: string, locale: string): string {
  return formatDayLabel(day, { weekday: "short", day: "numeric", month: "short" }, locale);
}

/** A horizontal strip of the trip's days, each with its photo count, plus "Alle". */
export default function GalleryDayStrip({ days, total, selected, onSelect }: Props): JSX.Element {
  const { t } = useTranslation("immich");
  const locale = useLocale();
  const active = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // jsdom has no scrollIntoView; the strip is still usable without it.
    active.current?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [selected]);

  const chip = (key: string, label: string, count: number): JSX.Element => (
    <button
      key={key}
      ref={key === selected ? active : undefined}
      type="button"
      data-testid="gallery-day-chip"
      aria-pressed={key === selected}
      onClick={() => onSelect(key)}
      className={`flex shrink-0 flex-col items-center rounded-md border px-3 py-1 text-xs ${
        key === selected
          ? "border-(--accent) bg-(--accent) text-(--bg-base)"
          : "border-(--color-border) text-(--text-secondary)"
      }`}
    >
      <span className="font-medium whitespace-nowrap">{label}</span>
      <span className="opacity-80">{count}</span>
    </button>
  );

  return (
    <div
      role="group"
      aria-label={t("albums.dayStripLabel")}
      className="mb-3 flex gap-1.5 overflow-x-auto pb-1"
    >
      {chip(ALL_DAYS, t("albums.dayAll"), total)}
      {days.map((d) =>
        chip(dayKey(d), d.day ? formatDayChip(d.day, locale) : t("albums.undated"), d.count)
      )}
    </div>
  );
}
