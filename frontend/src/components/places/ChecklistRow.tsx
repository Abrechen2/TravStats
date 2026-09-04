import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { FlagImg } from "../../lib/countryFlag";
import { curatedText } from "../../lib/curatedCopy";
import type { CuratedProgressItem, VisitSuggestion } from "../../types/placeList";

interface Props {
  item: CuratedProgressItem;
  /** The evidence that the user was probably here, or null. */
  suggestion: VisitSuggestion | null;
  /** The checklist's colour — the tick box fills with it. */
  accent: string;
  busy: boolean;
  /** The country or continent this row was sorted into, or null when the list
   *  is in its own catalog order. Shown so the ordering is visible. */
  groupLabel?: string | null;
  onToggle: (item: CuratedProgressItem, visitedAt?: string | null) => void;
}

/**
 * One row of a checklist — a ticked place, or a ghost.
 *
 * Split out of the page when the World Heritage list arrived: the page grew
 * filters and a suggestion banner, and a 1247-row loop had no business sitting
 * inside all of that.
 *
 * The two states are told apart by SHAPE, not colour — a hollow, dashed row for
 * a target that is not in the logbook. The same measurement the pin layer makes
 * for wishlist pins, and for the same reason.
 */
export function ChecklistRow({
  item,
  suggestion,
  accent,
  busy,
  groupLabel = null,
  onToggle,
}: Props): JSX.Element {
  const { t, i18n } = useTranslation(["places", "common"]);
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  const name = curatedText(item.name, item.nameEn, i18n.language);

  const suggestedDate = suggestion?.visitedAt
    ? dateFormat.format(new Date(suggestion.visitedAt))
    : null;

  // "0 km entfernt" is not a sentence. Under a kilometre the anchor IS the
  // place, and saying so reads as the stronger claim it actually is.
  const distance =
    suggestion === null
      ? ""
      : suggestion.distanceKm < 1
        ? t("places:checklist.rightThere")
        : t("places:checklist.kmAway", { km: suggestion.distanceKm });

  return (
    <li
      className="flex items-start gap-3 rounded-xl px-4 py-3"
      style={
        item.ticked
          ? { background: "var(--bg-surface)", border: "1px solid var(--color-border)" }
          : {
              background: "transparent",
              // A suggested ghost is still a ghost — it keeps the dashed edge
              // and only borrows the accent, because it has NOT been visited
              // until the user says so.
              border: suggestion
                ? "1px dashed rgba(63,185,80,0.55)"
                : "1px dashed var(--color-border)",
            }
      }
    >
      <button
        type="button"
        disabled={busy}
        onClick={() => onToggle(item, suggestion?.visitedAt ?? null)}
        aria-pressed={item.ticked}
        aria-label={
          item.ticked
            ? t("places:checklist.untickItem", { name: item.name })
            : t("places:checklist.tickItem", { name: item.name })
        }
        style={{
          width: 22,
          height: 22,
          flex: "none",
          marginTop: 2,
          borderRadius: 6,
          cursor: busy ? "wait" : "pointer",
          background: item.ticked ? accent : "transparent",
          border: item.ticked ? "none" : "1.5px dashed var(--color-border)",
          color: "#0d1117",
          fontSize: 13,
          lineHeight: "22px",
        }}
      >
        {item.ticked ? "✓" : ""}
      </button>

      <div className="min-w-0 flex-1">
        <p
          className="flex items-center gap-2 text-sm"
          style={{ color: item.ticked ? "var(--text-primary)" : "var(--text-muted)" }}
        >
          {item.ticked && item.placeId ? (
            <Link to={`/places/${item.placeId}`} style={{ color: "inherit" }}>
              {name}
            </Link>
          ) : (
            name
          )}
          {(item.isoCountryCode ?? item.country) && (
            <FlagImg country={item.isoCountryCode ?? item.country ?? ""} />
          )}
          {groupLabel && (
            <span
              className="rounded px-1.5 py-0.5 text-[11px]"
              style={{ border: "1px solid var(--color-border)", color: "var(--text-muted)" }}
            >
              {groupLabel}
            </span>
          )}
        </p>
        {item.blurb && (
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            {curatedText(item.blurb, item.blurbEn, i18n.language)}
          </p>
        )}

        {/* The suggestion, with its reason. "Wahrscheinlich" on its own is not
            checkable; "Hotel Roma, 3 km entfernt" is — so the anchor and the
            distance are always shown, never just a confidence word. */}
        {!item.ticked && suggestion && (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span style={{ color: "var(--success)" }}>
              {t(`places:checklist.anchor.${suggestion.anchorKind}`, {
                // A photo anchor labels itself with the TRIP it belongs to, and a
                // photo need not belong to one — so the empty label is the normal
                // case here, not the exception. The generic fallback would then
                // claim "a recorded place", which is the one thing this anchor is
                // not: it is a GPS fix from a shutter, with no place behind it.
                label:
                  suggestion.anchorLabel ||
                  t(
                    suggestion.anchorKind === "photo"
                      ? "places:checklist.anchorUnnamedPhoto"
                      : "places:checklist.anchorUnnamed"
                  ),
                distance,
              })}
              {suggestedDate ? ` · ${suggestedDate}` : ""}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => onToggle(item, suggestion.visitedAt)}
              className="rounded px-2 py-0.5"
              style={{
                border: "1px solid rgba(63,185,80,0.45)",
                color: "var(--success)",
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {t("places:checklist.acceptSuggestion")}
            </button>
          </p>
        )}
      </div>

      <span className="shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
        {item.ticked
          ? item.lastVisitAt
            ? dateFormat.format(new Date(item.lastVisitAt))
            : t("places:detail.undated")
          : suggestion
            ? t(`places:checklist.confidence.${suggestion.confidence}`)
            : t("places:checklist.notYet")}
      </span>
    </li>
  );
}
