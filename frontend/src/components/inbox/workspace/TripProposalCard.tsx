import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/displayFormat";
import { tripSuggestionsApi } from "../../../lib/api/tripSuggestions";
import type { TripSuggestion } from "../../../types/tripSuggestion";
import TripSuggestionEditor, { domainKey } from "../TripSuggestionEditor";
import { suggestedTripName } from "../tripSuggestionCopy";
import Button from "../../ui/Button";
import type { InboxAction } from "./FlagQuickEditor";
import { W } from "./model";

const NS = "dataQuality:inbox.tripSuggestions";
export default function TripProposalCard({
  suggestion: s,
  busy,
  act,
}: {
  suggestion: TripSuggestion;
  busy: boolean;
  act: InboxAction;
}) {
  const { t, i18n } = useTranslation(["dataQuality", "common"]);
  const format = useDisplayFormat();
  const [editing, setEditing] = useState(true);
  const day = (d: string) => format.date(`${d}T00:00:00Z`, { timeZone: "UTC" });
  const name = suggestedTripName(s, i18n.language, t);
  const reason = t(
    `${NS}.reason.${s.kind === "new_trip" ? "newTrip" : s.kind === "place_visit" ? "placeVisit" : s.kind}`,
    {
      count: s.members.length,
      trip: s.trip?.name ?? "",
      anchor: s.anchor?.label ?? "",
      distance: s.distanceM ?? 0,
      entries: t(`${NS}.reason.entries`, { count: s.members.length }),
      nights: t(`${NS}.reason.nights`, { count: s.nights ?? 0 }),
      span: s.newSpan ? `${day(s.newSpan.startDay)} – ${day(s.newSpan.endDay)}` : "",
    }
  );
  return (
    <div className="space-y-3">
      <h4 className="t-label-mono">{t(`${W}.why`)}</h4>
      <p className="text-sm">{reason}</p>
      <p className="t-caption">
        {day(s.startDay)} – {day(s.endDay)}
        {s.planned ? ` · ${t(`${NS}.planned`)}` : ""}
      </p>
      {s.signals.length > 0 && (
        <p className="t-caption">
          {s.signals.map((signal) => t(`${NS}.signals.${signal}`)).join(" · ")}
        </p>
      )}
      {s.zoneUnknown > 0 && (
        <p role="note" className="text-sm text-(--ts-warn)">
          {t(`${NS}.zoneUnknown`, { count: s.zoneUnknown })}
        </p>
      )}
      {s.trip && (
        <p className="text-sm">
          <Link className="underline" to={`/trips/${s.trip.id}`}>
            {s.trip.name}
          </Link>
          {s.trip.startDay && s.trip.endDay
            ? ` · ${day(s.trip.startDay)} – ${day(s.trip.endDay)}`
            : ""}
        </p>
      )}
      <ol className="space-y-2 border-l-2 border-(--ts-border) pl-4">
        {[...s.members]
          .sort((a, b) => a.startDay.localeCompare(b.startDay))
          .map((m) => (
            <li key={m.key} className="text-sm">
              <span className="t-caption">
                {day(m.startDay)}
                {m.endDay !== m.startDay ? ` – ${day(m.endDay)}` : ""} ·{" "}
                {t(`common:domain.${domainKey(m.domain)}`)}
              </span>
              <p>{m.label}</p>
            </li>
          ))}
      </ol>
      <p className="t-caption">{t(`${NS}.creates.${s.kind}`)}</p>
      <fieldset disabled={busy} className="min-w-0">
        {editing ? (
          <TripSuggestionEditor
            suggestion={s}
            initialName={name}
            busy={busy}
            submitLabel={t(`${W}.acceptProposal.${s.kind}`, { count: s.members.length })}
            onSubmit={(edits) => void act(() => tripSuggestionsApi.accept(s.id, edits))}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <Button onClick={() => setEditing(true)}>{t(`${W}.editProposal`)}</Button>
        )}
        <Button
          className="mt-3"
          disabled={busy}
          onClick={() => void act(() => tripSuggestionsApi.dismiss(s.id))}
        >
          {t(`${W}.dismissProposal.${s.kind}`)}
        </Button>
      </fieldset>
    </div>
  );
}
