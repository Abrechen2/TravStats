import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { PlaceRelations } from "../../lib/api/places";
import type { Place } from "../../types/place";

/**
 * What a merge does, said before it is confirmed (forgejo#232): what moves
 * from the other place, that a list both are in keeps one entry, that the
 * other place is deleted afterwards, and what "visited" will say.
 *
 * Counts come from `GET /places/:id/related`. While they load the panel says
 * so; when they cannot be had it says THAT, and that everything moves anyway —
 * never "nothing to move".
 */
export function PlaceMergeImpact({
  keptName,
  source,
  relations,
  countsFailed,
  visitedEither,
}: {
  keptName: string;
  source: Place;
  relations: PlaceRelations | null;
  countsFailed: boolean;
  visitedEither: boolean;
}): JSX.Element {
  const { t } = useTranslation(["places"]);
  const lines: string[] = [];
  if (relations !== null) {
    lines.push(t("places:merge.impact.visits", { count: relations.visitCount }));
    if (relations.photoCount > 0)
      lines.push(t("places:merge.impact.photos", { count: relations.photoCount }));
    if (relations.documentCount > 0)
      lines.push(t("places:merge.impact.documents", { count: relations.documentCount }));
    if (relations.lists.length > 0)
      lines.push(
        t("places:merge.impact.lists", {
          count: relations.lists.length,
          names: relations.lists.map((l) => l.name).join(", "),
        })
      );
    if (relations.roadtripStationCount > 0)
      lines.push(t("places:merge.impact.stations", { count: relations.roadtripStationCount }));
  }

  return (
    <section
      aria-labelledby="place-merge-impact"
      className="rounded-lg p-3 text-sm"
      style={{ border: "1px solid var(--color-border)", background: "var(--bg-surface)" }}
    >
      <h3 id="place-merge-impact" className="t-label-mono mb-2">
        {t("places:merge.impact.title", { name: source.name, kept: keptName })}
      </h3>
      {relations === null ? (
        <p role="status" style={{ color: "var(--text-muted)" }}>
          {countsFailed ? t("places:merge.impact.unknown") : t("places:merge.impact.counting")}
        </p>
      ) : (
        <ul className="list-disc pl-5">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <p className="mt-2" style={{ color: "var(--text-secondary)" }}>
        {t("places:merge.impact.deleted", { name: source.name })}{" "}
        {/* Its source reference stays as a second reference of the kept place,
            so a later import or search pick of it finds that place (review I1). */}
        {source.externalRef ? `${t("places:merge.impact.refKept", { name: source.name })} ` : ""}
        {visitedEither ? t("places:merge.impact.visited") : t("places:merge.impact.wishlist")}
      </p>
    </section>
  );
}
