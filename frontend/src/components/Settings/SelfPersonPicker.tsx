import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { coverSuggestionsApi, type PhotoSourcePerson } from "../../lib/api/coverSuggestions";
import { failureKey, immichFailureKind } from "../../lib/api/immich";
import { logger } from "../../lib/logger";
import type { PhotoSourceKind } from "../../types/immich";
import { token } from "../ui/tokens";

type Outcome = { tone: "good" | "bad"; text: string };

/**
 * "Das bin ich" (cover suggestions): which recognised person of a photo source
 * is the account holder. The list is read from the source only when the button
 * is pressed and kept in this component's state; the server stores the chosen
 * id and nothing else, so no face data is kept anywhere.
 */
export default function SelfPersonPicker({
  provider,
  name,
}: {
  provider: PhotoSourceKind;
  name: string;
}): JSX.Element {
  const { t } = useTranslation("immich");
  const [people, setPeople] = useState<PhotoSourcePerson[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const reasonOf = (err: unknown): string => t(failureKey(immichFailureKind(err), provider));

  const load = async (): Promise<void> => {
    setBusy(true);
    setOutcome(null);
    try {
      const result = await coverSuggestionsApi.listPeople(provider);
      setPeople(result.people);
      setSelected(result.selfPersonId ?? "");
    } catch (err) {
      logger.error("SelfPersonPicker: load failed", err);
      setOutcome({ tone: "bad", text: t("selfPerson.loadFailed", { reason: reasonOf(err) }) });
    } finally {
      setBusy(false);
    }
  };

  const choose = async (personId: string): Promise<void> => {
    const previous = selected;
    setSelected(personId);
    setBusy(true);
    setOutcome(null);
    try {
      await coverSuggestionsApi.setSelf(provider, personId === "" ? null : personId);
      setOutcome({ tone: "good", text: t("selfPerson.saved") });
    } catch (err) {
      logger.error("SelfPersonPicker: save failed", err);
      setSelected(previous);
      setOutcome({ tone: "bad", text: t("selfPerson.saveFailed") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1" data-testid={`self-person-${provider}`}>
      <span className="label">{t("selfPerson.title")}</span>
      <p className="t-caption">{t("selfPerson.hint", { name })}</p>
      {people === null ? (
        <button
          type="button"
          className="btn-secondary self-start"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? t("selfPerson.loading") : t("selfPerson.load")}
        </button>
      ) : people.length === 0 ? (
        <p className="t-caption">{t("selfPerson.empty", { name })}</p>
      ) : (
        <select
          className="input self-start"
          style={{ minHeight: "var(--ts-size-touch-min)" }}
          aria-label={t("selfPerson.label", { name })}
          value={selected}
          disabled={busy}
          onChange={(e) => void choose(e.target.value)}
        >
          <option value="">{t("selfPerson.none")}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {outcome && (
        <p role="status" className="text-sm" style={{ color: token(outcome.tone) }}>
          {outcome.text}
        </p>
      )}
    </div>
  );
}
