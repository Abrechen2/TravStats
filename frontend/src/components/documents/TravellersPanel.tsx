import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import {
  entryTravellersApi,
  TRAVELLER_FACT_FIELDS,
  type EntryTraveller,
  type FactValue,
  type TravellerEntryType,
} from "../../lib/api/entryTravellers";
import { logger } from "../../lib/logger";

/**
 * The people on an entry with their OWN facts (plan D7): seat, class, ticket
 * number, booking reference and loyalty number — a cabin on a cruise, a driver
 * flag on a rental. The owner's own values stay on the entry. Each person lists
 * their documents; a value a parse filled in says so and stays editable.
 */
export function TravellersPanel({
  type,
  id,
  travellers,
  readOnly,
  onSaved,
}: {
  type: TravellerEntryType;
  id: string;
  travellers: readonly EntryTraveller[];
  readOnly: boolean;
  onSaved: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["documents"]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, FactValue>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = TRAVELLER_FACT_FIELDS[type];

  if (travellers.length === 0) return null;

  const start = (c: EntryTraveller): void => {
    setEditing(c.companionId);
    setDraft({ ...c.facts });
    setError(null);
  };

  const save = async (c: EntryTraveller): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await entryTravellersApi.setFacts(type, id, c.companionId, draft);
      setEditing(null);
      onSaved();
    } catch (err: unknown) {
      logger.error({ err, type, id }, "TravellersPanel: save failed");
      const gone = (err as { response?: { status?: number } }).response?.status === 404;
      setError(t(gone ? "documents:travellers.notOnEntry" : "documents:travellers.saveFailed"));
      if (gone) onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="flex flex-col"
      style={{ gap: "var(--ts-space-sm)" }}
      aria-label={t("documents:travellers.title")}
      data-testid="travellers-panel"
    >
      <h3 className="text-sm font-semibold">{t("documents:travellers.title")}</h3>
      <p className="t-caption">{t("documents:travellers.hint")}</p>
      <ul className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
        {travellers.map((c) => (
          <li
            key={c.companionId}
            className="flex min-w-0 flex-col"
            style={{ gap: "var(--ts-space-xs)" }}
          >
            <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
              <span className="text-sm" style={{ fontWeight: 600 }}>
                {c.displayName}
              </span>
              <span className="t-caption">
                {c.documents.length === 0
                  ? t("documents:travellers.noDocuments")
                  : `${t("documents:travellers.documents", { count: c.documents.length })}: ${c.documents
                      .map((d) => d.displayName)
                      .join(", ")}`}
              </span>
              {!readOnly && editing !== c.companionId && (
                <button
                  type="button"
                  onClick={() => start(c)}
                  aria-label={t("documents:travellers.editLabel", { name: c.displayName })}
                  className="t-caption pointer-coarse:min-h-(--ts-size-touch-min)"
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: "var(--ts-muted)",
                  }}
                >
                  {t("documents:travellers.edit")}
                </button>
              )}
            </div>
            {editing !== c.companionId ? (
              <FactsSummary traveller={c} fields={fields} />
            ) : (
              <form
                className="flex flex-wrap items-end"
                style={{ gap: "var(--ts-space-md)" }}
                onSubmit={(e): void => {
                  e.preventDefault();
                  void save(c);
                }}
              >
                {fields.text.map((key) => (
                  <label key={key} className="flex flex-col t-caption" style={{ gap: 2 }}>
                    {t(`documents:travellers.fact.${key}`)}
                    <input
                      value={(draft[key] as string | null) ?? ""}
                      maxLength={80}
                      onChange={(e): void => setDraft({ ...draft, [key]: e.target.value })}
                      className="rounded-md border border-border bg-(--bg-surface) px-2 py-1 text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
                    />
                  </label>
                ))}
                {fields.flags.map((key) => (
                  <label
                    key={key}
                    className="flex items-center t-caption"
                    style={{ gap: "var(--ts-space-xs)" }}
                  >
                    <input
                      type="checkbox"
                      checked={draft[key] === true}
                      onChange={(e): void => setDraft({ ...draft, [key]: e.target.checked })}
                    />
                    {t(`documents:travellers.fact.${key}`)}
                  </label>
                ))}
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md px-3 py-2 text-xs"
                  style={{ border: "1px solid var(--ts-border)" }}
                >
                  {t("documents:travellers.save")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={(): void => setEditing(null)}
                  className="t-caption"
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--ts-muted)",
                  }}
                >
                  {t("documents:travellers.cancel")}
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="t-caption" role="alert" style={{ color: "var(--ts-warn)" }}>
          {error}
        </p>
      )}
    </section>
  );
}

function FactsSummary({
  traveller,
  fields,
}: {
  traveller: EntryTraveller;
  fields: { text: readonly string[]; flags: readonly string[] };
}): JSX.Element | null {
  const { t } = useTranslation(["documents"]);
  const parts = [
    ...fields.text.flatMap((key) =>
      traveller.facts[key]
        ? [`${t(`documents:travellers.fact.${key}`)}: ${traveller.facts[key]}`]
        : []
    ),
    ...fields.flags.flatMap((key) =>
      traveller.facts[key] === true ? [t(`documents:travellers.fact.${key}`)] : []
    ),
  ];
  if (parts.length === 0) return null;
  return (
    <p className="t-caption" data-testid="traveller-facts">
      {parts.join(" · ")}
      {traveller.factsSource === "auto" && ` · ${t("documents:travellers.auto")}`}
    </p>
  );
}
