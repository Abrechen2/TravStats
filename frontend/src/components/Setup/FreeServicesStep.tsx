import { useTranslation } from "../../hooks/useTranslation";

interface FreeServicesStepProps {
  value: boolean;
  onChange: (next: boolean) => void;
}

/** Services the button covers, in the words of the catalogue (names only: the details live in Admin). */
const SERVICE_IDS = ["adsblol", "railTimetables", "openData", "logos"] as const;

/**
 * One switch on the first-run form: "turn on the free services". It does not
 * call anything itself (no admin exists yet); the page applies the choice right
 * after the account is created. The usage-statistics question beside it stays
 * its own decision.
 */
export default function FreeServicesStep({ value, onChange }: FreeServicesStepProps): JSX.Element {
  const { t } = useTranslation(["setup", "externalServices"]);
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--bg-muted)", border: "1px solid var(--color-border)" }}
      data-testid="free-services-step"
    >
      <h2 className="text-sm font-semibold mb-1 text-(--text-primary)">
        {t("setup:freeServices.title")}
      </h2>
      <p className="text-xs text-(--text-muted) mb-2">{t("setup:freeServices.description")}</p>
      <ul className="text-xs text-(--text-muted) mb-2 list-disc pl-5">
        {SERVICE_IDS.map((id) => (
          <li key={id}>
            <span className="font-medium text-(--text-secondary)">
              {t(`externalServices:services.${id}.name`)}
            </span>
            {" – "}
            {t(`externalServices:services.${id}.dataOut`)}
          </li>
        ))}
      </ul>
      <p className="text-xs text-(--text-muted) mb-2">{t("setup:freeServices.leaves")}</p>
      <p className="text-xs text-(--text-muted) mb-3">{t("setup:freeServices.alreadyOn")}</p>
      <button
        type="button"
        aria-pressed={value}
        onClick={() => onChange(!value)}
        className={`${value ? "btn-primary" : "btn-secondary"} w-full py-2 text-sm font-medium`}
      >
        {value ? t("setup:freeServices.on") : t("setup:freeServices.cta")}
      </button>
    </div>
  );
}
