import { useState } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import type { TripSuggestion, TripSuggestionEdits } from "../../types/tripSuggestion";
import Button from "../ui/Button";

const NS = "dataQuality:inbox.tripSuggestions";

const inputStyle = {
  background: "var(--ts-surface)",
  borderColor: "var(--ts-border)",
  color: "var(--ts-text-bright)",
};

/**
 * "Bearbeiten" before accepting: the name (new trips), the span (trip kinds),
 * which entries go in, or the day of a visit.
 *
 * It only shapes the request. Whatever the server then refuses — a member
 * that moved meanwhile, an end before the start — comes back as a code the
 * tab turns into a sentence; this form never pretends a save it has not seen.
 */
export default function TripSuggestionEditor({
  suggestion,
  initialName,
  busy,
  onSubmit,
  onCancel,
}: {
  suggestion: TripSuggestion;
  initialName: string;
  busy: boolean;
  onSubmit: (edits: TripSuggestionEdits) => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useTranslation(["dataQuality", "common"]);
  const isVisit = suggestion.kind === "place_visit";
  const span = suggestion.newSpan ?? suggestion;
  const [name, setName] = useState(initialName);
  const [startDay, setStartDay] = useState(span.startDay);
  const [endDay, setEndDay] = useState(span.endDay);
  const [visitDay, setVisitDay] = useState(suggestion.startDay);
  const [kept, setKept] = useState<ReadonlySet<string>>(
    new Set(suggestion.members.map((m) => m.key))
  );

  const toggle = (key: string): void =>
    setKept((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const invalidSpan = !isVisit && endDay < startDay;
  const nothingKept = !isVisit && kept.size === 0;

  const submit = (): void => {
    if (isVisit) {
      onSubmit({ visitDay });
      return;
    }
    onSubmit({
      ...(suggestion.kind === "new_trip" && { name: name.trim() || initialName }),
      startDay,
      endDay,
      memberKeys: suggestion.members.map((m) => m.key).filter((key) => kept.has(key)),
    });
  };

  return (
    <form
      className="mt-3 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {suggestion.kind === "new_trip" && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="t-caption">{t(`${NS}.edit.name`)}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            className="rounded-md border px-3 py-2"
            style={inputStyle}
          />
        </label>
      )}

      {isVisit ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="t-caption">{t(`${NS}.edit.visitDay`)}</span>
          <input
            type="date"
            value={visitDay}
            onChange={(e) => setVisitDay(e.target.value)}
            className="rounded-md border px-3 py-2"
            style={inputStyle}
          />
        </label>
      ) : (
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="t-caption">{t(`${NS}.edit.start`)}</span>
            <input
              type="date"
              value={startDay}
              onChange={(e) => setStartDay(e.target.value)}
              className="rounded-md border px-3 py-2"
              style={inputStyle}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="t-caption">{t(`${NS}.edit.end`)}</span>
            <input
              type="date"
              value={endDay}
              onChange={(e) => setEndDay(e.target.value)}
              className="rounded-md border px-3 py-2"
              style={inputStyle}
            />
          </label>
        </div>
      )}

      {!isVisit && (
        <fieldset className="flex flex-col gap-1">
          <legend className="t-caption mb-1">{t(`${NS}.edit.members`)}</legend>
          {suggestion.members.map((member) => (
            <label key={member.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={kept.has(member.key)}
                onChange={() => toggle(member.key)}
              />
              <span>{member.label || t(`common:domain.${domainKey(member.domain)}`)}</span>
            </label>
          ))}
        </fieldset>
      )}

      {invalidSpan && (
        <p role="alert" className="t-caption" style={{ color: "var(--ts-warn)" }}>
          {t(`${NS}.errors.endBeforeStart`)}
        </p>
      )}
      {nothingKept && (
        <p role="alert" className="t-caption" style={{ color: "var(--ts-warn)" }}>
          {t(`${NS}.errors.noMembers`)}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy || invalidSpan || nothingKept}>
          {t(`${NS}.actions.acceptEdited`)}
        </Button>
        <Button type="button" onClick={onCancel} disabled={busy}>
          {t("common:buttons.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** A member's domain as the common domain labels name it (`place` is `poi` there). */
export function domainKey(domain: TripSuggestion["members"][number]["domain"]): string {
  return domain === "place" ? "poi" : domain;
}
