import { useEffect, useState } from "react";

/**
 * Which of the given section ids is on screen, for an index column to mark.
 *
 * An IntersectionObserver over the section landmarks (`${idPrefix}-${id}`):
 * the topmost section that reaches the upper third of the viewport wins.
 * Absent in jsdom, where the index simply marks nothing — the same
 * degradation SettingsPage always used, and where this hook started life as
 * a private helper. Round 4 gave AdminPage the identical "one page, anchor
 * jumps" treatment, so the hook moved here rather than being copied a
 * second time with a second, sure-to-drift `rootMargin`.
 *
 * `idPrefix` is the landmark's namespace ("settings" -> `settings-<id>`,
 * "admin" -> `admin-<id>`) — the two pages' ids are otherwise
 * indistinguishable ("backups", "logging", … exist on both).
 */
export function useSectionInView(ids: readonly string[], idPrefix: string): string | null {
  const [inView, setInView] = useState<string | null>(ids[0] ?? null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    const prefix = `${idPrefix}-`;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.startsWith(prefix)
            ? entry.target.id.slice(prefix.length)
            : entry.target.id;
          if (entry.isIntersecting) visible.set(id, entry.boundingClientRect.top);
          else visible.delete(id);
        }
        const first = ids.find((id) => visible.has(id));
        if (first) setInView(first);
      },
      { rootMargin: "-80px 0px -60% 0px" }
    );
    for (const id of ids) {
      const el = document.getElementById(`${prefix}${id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids, idPrefix]);
  return inView;
}
