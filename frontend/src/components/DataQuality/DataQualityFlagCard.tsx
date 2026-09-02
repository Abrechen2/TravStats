import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { countryName } from "../../shared/geo/countryCode";
import type { DataQualityFlag } from "../../types/dataQuality";

import FlagContradiction from "./FlagContradiction";
import { flaggedRecordPath } from "./flagLinks";

/**
 * One open question about one record.
 *
 * ## The two buttons are two answers, and the labels say so
 *
 * `resolve` and `dismiss` are not synonyms and must not read like a pair of
 * "OK" buttons, because a user who takes them for the same thing will use the
 * permanent one to hide a real fault:
 *
 * - **"Ich habe es korrigiert" / "I have corrected it"** — a statement about
 *   what the USER just did. The next run re-opens the flag if the contradiction
 *   survived, which is what stops the button from being a way of hiding a
 *   fault, and the hint under it says exactly that.
 * - **"Das stimmt so" / "This is correct as it is"** — a statement about what is
 *   TRUE. Nothing was changed and nothing needs changing; the question is never
 *   asked again. This is the escape hatch for a check that is right about the
 *   disagreement and wrong about the conclusion — an address ending "…, Atlanta,
 *   Georgia", where a subdivision shares a country's name.
 *
 * One is first person past tense about an edit, the other is present tense about
 * the data. Each carries the consequence as a permanent hint rather than a
 * tooltip, because the difference only matters at the moment of clicking.
 *
 * ## Reaching the record (design §3.4)
 *
 * The subject is a link wherever it is a row. For a `country` flag it is not —
 * a country has no page — so the records that proved it are listed inside the
 * contradiction and each of those links. Either way, nothing here is a name the
 * user cannot get to and edit.
 *
 * ## Naming the subject
 *
 * A row arrives already named: `subject.label` is the user's own text. A country
 * arrives as an ISO code and carries no label at all, because only this side
 * knows the reader's language — see `types/dataQuality.ts`. So the two cases are
 * two branches here, not one field read twice, and a code is never printed where
 * a name belongs: an ISO code `Intl` cannot name says so in words.
 */

/**
 * What to call the subject on screen.
 *
 * Two branches because the wire carries two shapes, not one field meaning two
 * things: a country arrives as an ISO code with no label, a row arrives with the
 * user's own text. `flag.entityId` is the same code as `subject.countryCode`, so
 * a country still gets its name when the subject is missing altogether.
 */
function subjectLabelOf(
  flag: DataQualityFlag,
  countryLabel: (code: string) => string,
  unnamed: string
): string {
  const subject = flag.subject;
  if (subject?.entityType === "country") return countryLabel(subject.countryCode);
  if (flag.entityType === "country") return countryLabel(flag.entityId);
  return subject?.label || unnamed;
}

interface DataQualityFlagCardProps {
  flag: DataQualityFlag;
  onResolve: () => void;
  onDismiss: () => void;
  busy?: boolean;
}

export default function DataQualityFlagCard({
  flag,
  onResolve,
  onDismiss,
  busy = false,
}: DataQualityFlagCardProps): JSX.Element {
  const { t, i18n } = useTranslation(["dataQuality", "common"]);

  const countryLabel = (code: string): string =>
    // Never the bare code: an unnamed code on the line where a hotel name would
    // stand reads as a hotel called "CZ". Saying "unknown country (CZ)" keeps
    // the code visible AND says what it is.
    countryName(code, i18n.language) || t("dataQuality:flag.unknownCountry", { code });

  // The path is built from the FLAG, not from `subject`: `entityType` and
  // `entityId` are always present, so a flag whose subject failed to resolve
  // still reaches its record (design §3.4) and only loses its name. The server
  // drops such a flag rather than shipping it, so this is a guard against a
  // page that throws, not an expected state. A country has no page at all.
  const subjectPath =
    flag.entityType === "country"
      ? null
      : flaggedRecordPath({
          entityType: flag.entityType,
          entityId: flag.entityId,
          label: "",
        });

  const subjectLabel = subjectLabelOf(flag, countryLabel, t("dataQuality:flag.unnamedRecord"));

  return (
    <div
      className="rounded-lg shadow-xs p-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span
          className="px-2 py-1 rounded-sm text-xs font-medium"
          style={{ background: "var(--bg-elevated)", color: "var(--text-primary)" }}
        >
          {t(`dataQuality:kinds.${flag.kind}.title`)}
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {t(`dataQuality:flag.entityType.${flag.entityType}`)}
        </span>
        {flag.status !== "open" && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            · {t(`dataQuality:flag.status.${flag.status}`)}
          </span>
        )}
      </div>

      <h3 className="text-lg font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
        {subjectPath ? (
          <Link to={subjectPath} className="underline" style={{ color: "var(--accent)" }}>
            {subjectLabel}
          </Link>
        ) : (
          subjectLabel
        )}
      </h3>

      <FlagContradiction flag={flag} />

      <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>
        {t("dataQuality:flag.neitherIsCorrect")}
      </p>

      {flag.status === "open" && (
        <div className="flex flex-wrap gap-3 mt-4">
          <div className="flex-1 min-w-[180px]">
            <button
              type="button"
              onClick={onResolve}
              disabled={busy}
              className="btn-primary w-full disabled:opacity-50"
            >
              {t("dataQuality:flag.actions.resolve.label")}
            </button>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              {t("dataQuality:flag.actions.resolve.hint")}
            </p>
          </div>
          <div className="flex-1 min-w-[180px]">
            <button
              type="button"
              onClick={onDismiss}
              disabled={busy}
              className="btn-secondary w-full disabled:opacity-50"
            >
              {t("dataQuality:flag.actions.dismiss.label")}
            </button>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              {t("dataQuality:flag.actions.dismiss.hint")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
