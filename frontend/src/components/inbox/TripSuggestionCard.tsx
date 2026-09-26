import { useState } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import type { TripSuggestion, TripSuggestionEdits } from "../../types/tripSuggestion";
import Button from "../ui/Button";

import TripSuggestionEditor, { domainKey } from "./TripSuggestionEditor";

const NS = "dataQuality:inbox.tripSuggestions";

/**
 * One proposal: what, when, why — and the three answers.
 *
 * The "why" is always on the card, never behind a tooltip: a proposal is a
 * claim about the user's own life ("5 Einträge, 4 Nächte fern von zu Hause"),
 * and a claim the reader cannot check is one they learn to click through.
 * Every member is listed, so accepting never links something unseen.
 */
export default function TripSuggestionCard({
  suggestion,
  name,
  busy,
  onAccept,
  onDismiss,
}: {
  suggestion: TripSuggestion;
  /** The localized name a new trip is offered under. */
  name: string;
  busy: boolean;
  onAccept: (edits: TripSuggestionEdits) => void;
  onDismiss: () => void;
}): JSX.Element {
  const { t } = useTranslation(["dataQuality", "common"]);
  const format = useDisplayFormat();
  const [editing, setEditing] = useState(false);

  const day = (d: string): string => format.date(`${d}T00:00:00Z`, { timeZone: "UTC" });
  const range = (from: string, to: string): string =>
    from === to ? day(from) : `${day(from)} – ${day(to)}`;

  const count = suggestion.members.length;
  const tripName = suggestion.trip?.name ?? "";
  const heading =
    suggestion.kind === "new_trip"
      ? name
      : suggestion.kind === "place_visit"
        ? (suggestion.place?.name ?? "")
        : tripName;

  const reason =
    suggestion.kind === "new_trip"
      ? t(`${NS}.reason.newTrip`, {
          entries: t(`${NS}.reason.entries`, { count }),
          nights: t(`${NS}.reason.nights`, { count: suggestion.nights ?? 0 }),
        })
      : suggestion.kind === "assign"
        ? t(`${NS}.reason.assign`, { count, trip: tripName })
        : suggestion.kind === "extend"
          ? t(`${NS}.reason.extend`, {
              count,
              trip: tripName,
              span: suggestion.newSpan
                ? range(suggestion.newSpan.startDay, suggestion.newSpan.endDay)
                : "",
            })
          : t(`${NS}.reason.placeVisit`, {
              anchor: suggestion.anchor?.label ?? "",
              distance: suggestion.distanceM ?? 0,
            });

  // What an unedited accept sends: the localized name for a new trip (the
  // server never composes one in a language), nothing else.
  const quickEdits: TripSuggestionEdits = suggestion.kind === "new_trip" ? { name } : {};

  return (
    <div
      className="rounded-[var(--ts-radius-card)] p-4"
      style={{ background: "var(--ts-surface)", border: "1px solid var(--ts-border)" }}
      data-testid="trip-suggestion"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className="rounded-sm px-2 py-1 text-xs font-medium"
          style={{ background: "var(--ts-surface2)", color: "var(--ts-text-bright)" }}
        >
          {t(`${NS}.kind.${suggestion.kind}`)}
        </span>
        <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
          {range(suggestion.startDay, suggestion.endDay)}
        </span>
        {suggestion.planned && <span className="t-caption">{t(`${NS}.planned`)}</span>}
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}>{heading}</h3>
      <p className="t-caption mt-1">{reason}</p>
      {suggestion.zoneUnknown > 0 && (
        <p className="t-caption mt-1" style={{ color: "var(--ts-warn)" }}>
          {t(`${NS}.zoneUnknown`, { count: suggestion.zoneUnknown })}
        </p>
      )}
      {suggestion.signals.length > 0 && (
        <p className="t-caption mt-1">
          {suggestion.signals.map((s) => t(`${NS}.signals.${s}`)).join(" · ")}
        </p>
      )}

      {suggestion.members.length > 0 && !editing && (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {suggestion.members.map((member) => (
            <li key={member.key} className="flex flex-wrap gap-x-2">
              <span className="t-caption">{t(`common:domain.${domainKey(member.domain)}`)}</span>
              <span style={{ color: "var(--ts-text-bright)" }}>{member.label}</span>
              <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
                {range(member.startDay, member.endDay)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {suggestion.members.some((m) => m.domain === "tour") && (
        <p className="t-caption mt-2">{t(`${NS}.tourNote`)}</p>
      )}

      {editing ? (
        <TripSuggestionEditor
          suggestion={suggestion}
          initialName={name}
          busy={busy}
          onSubmit={onAccept}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <p className="t-caption mt-3">{t(`${NS}.creates.${suggestion.kind}`)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => onAccept(quickEdits)} disabled={busy}>
              {t(`${NS}.actions.accept`)}
            </Button>
            <Button onClick={() => setEditing(true)} disabled={busy}>
              {t(`${NS}.actions.edit`)}
            </Button>
            <Button onClick={onDismiss} disabled={busy}>
              {t(`${NS}.actions.dismiss`)}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
