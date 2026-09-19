import { useTranslation } from "../../hooks/useTranslation";
import {
  WORKSHOP_DOMAINS,
  WORKSHOP_DOMAIN_SPECS,
  type WorkshopDomain,
} from "../../shared/annotationLabels";

/**
 * What kind of document did you just upload?
 *
 * forgejo#124 phase 6. The server has already answered — `scoreDocument`
 * (forgejo#57) classifies the text on upload — so this is a CORRECTION, not a
 * question: the annotation step opens on the answer and the user changes it
 * when it is wrong. Asking first would put a modal in front of every upload
 * for a guess that is usually right.
 *
 * Where the workshop cannot derive a template for the chosen domain, it says
 * so HERE, before the annotating rather than after it. The annotation is
 * still worth recording — it is training data — and telling the user that
 * afterwards would be telling them once the work is done.
 */

interface DomainPickerProps {
  value: WorkshopDomain;
  /** What the classifier said, so the UI can mark a manual override. */
  detected: WorkshopDomain;
  onChange: (domain: WorkshopDomain) => void;
}

export default function DomainPicker({
  value,
  detected,
  onChange,
}: DomainPickerProps): JSX.Element {
  const { t } = useTranslation(["parser"]);
  const spec = WORKSHOP_DOMAIN_SPECS[value];

  return (
    <div
      className="p-4"
      style={{
        background: "var(--ts-surface)",
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card)",
      }}
    >
      <label
        className="block mb-1"
        htmlFor="workshop-domain"
        style={{ fontSize: 14, fontWeight: 700, color: "var(--ts-text-bright)" }}
      >
        {t("parser:workshop.domainTitle")}
      </label>
      <p className="t-caption mb-3">
        {value === detected
          ? t("parser:workshop.domainDetected", { domain: t(`parser:domains.${detected}`) })
          : t("parser:workshop.domainOverridden", { domain: t(`parser:domains.${detected}`) })}
      </p>
      <select
        id="workshop-domain"
        className="input w-full md:w-auto"
        value={value}
        onChange={(e) => onChange(e.target.value as WorkshopDomain)}
      >
        {WORKSHOP_DOMAINS.map((domain) => (
          <option key={domain} value={domain}>
            {t(`parser:domains.${domain}`)}
          </option>
        ))}
      </select>
      {!spec.derivable && spec.reason && (
        <p className="t-caption mt-3" style={{ color: "var(--warning)" }}>
          {t(`parser:derivation.cannot.${spec.reason}`)}
        </p>
      )}
    </div>
  );
}
