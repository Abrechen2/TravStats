import { useTranslation } from "../../hooks/useTranslation";
import {
  labelGroupsForDomain,
  labelsForDomain,
  type WorkshopDomain,
} from "../../shared/annotationLabels";

/**
 * Which field the user just marked — in the vocabulary of the domain the
 * document belongs to.
 *
 * forgejo#124 phase 6. Until now this was sixteen hardcoded German
 * `<optgroup>`s of flight fields inside `EmailAnnotation.tsx`, so a hotel
 * confirmation could only be annotated with "Flight Number" and "Gate", and
 * the deriver understood five of those labels anyway.
 *
 * The list comes from `shared/annotationLabels.ts`, which borrows each
 * domain's field names from the reader that already exists for it — so a
 * label offered here is a label something can actually read.
 */

interface AnnotationLabelSelectProps {
  domain: WorkshopDomain;
  value: string;
  onChange: (label: string) => void;
}

export default function AnnotationLabelSelect({
  domain,
  value,
  onChange,
}: AnnotationLabelSelectProps): JSX.Element {
  const { t } = useTranslation(["parser", "training"]);
  const labels = labelsForDomain(domain);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="input w-full"
      aria-label={t("parser:workshop.labelSelect")}
    >
      <option value="">{t("training:annotation.selectLabel")}</option>
      {labelGroupsForDomain(domain).map((group) => (
        <optgroup key={group} label={t(`parser:labelGroups.${group}`)}>
          {labels
            .filter((label) => label.group === group)
            .map((label) => (
              <option key={label.id} value={label.id}>
                {t(`parser:labels.${domain}.${label.id}`)}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}
