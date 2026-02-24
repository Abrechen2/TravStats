import { OnboardingState } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import OnboardingStep from "./OnboardingStep";

interface OnboardingGuideProps {
  onboarding: OnboardingState;
  onUpdate: (updates: Partial<OnboardingState>) => void;
}

type OnboardingStepConfig = {
  id: keyof OnboardingState;
  label: string;
  description: string;
  linkTo: string;
  linkText: string;
};

export default function OnboardingGuide({
  onboarding,
  onUpdate,
}: OnboardingGuideProps): JSX.Element {
  const { t } = useTranslation("onboarding");

  const steps: OnboardingStepConfig[] = [
    {
      id: "flightAdded",
      label: t("steps.flightAdded.label"),
      description: t("steps.flightAdded.description"),
      linkTo: "/",
      linkText: t("steps.flightAdded.linkText"),
    },
    {
      id: "usedFilter",
      label: t("steps.usedFilter.label"),
      description: t("steps.usedFilter.description"),
      linkTo: "/",
      linkText: t("steps.usedFilter.linkText"),
    },
    {
      id: "mapExplored",
      label: t("steps.mapExplored.label"),
      description: t("steps.mapExplored.description"),
      linkTo: "/",
      linkText: t("steps.mapExplored.linkText"),
    },
    {
      id: "statsViewed",
      label: t("steps.statsViewed.label"),
      description: t("steps.statsViewed.description"),
      linkTo: "/stats",
      linkText: t("steps.statsViewed.linkText"),
    },
    {
      id: "achievementsViewed",
      label: t("steps.achievementsViewed.label"),
      description: t("steps.achievementsViewed.description"),
      linkTo: "/achievements",
      linkText: t("steps.achievementsViewed.linkText"),
    },
    {
      id: "exported",
      label: t("steps.exported.label"),
      description: t("steps.exported.description"),
      linkTo: "/",
      linkText: t("steps.exported.linkText"),
    },
  ];

  const completedSteps = steps.filter((step) => onboarding[step.id]).length;
  const totalSteps = steps.length;
  const progressPercentage = (completedSteps / totalSteps) * 100;

  const handleStepChange = (stepId: keyof OnboardingState, checked: boolean): void => {
    onUpdate({ [stepId]: checked } as Partial<OnboardingState>);
  };

  return (
    <div className="card space-y-4 bg-[var(--bg-elevated)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">{t("title")}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {t("progress", { completed: completedSteps, total: totalSteps })}
          </p>
        </div>
        <button
          onClick={() => onUpdate({ dismissed: true })}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl leading-none"
          aria-label={t("dismissAria")}
        >
          x
        </button>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1">
        <div className="w-full bg-[var(--bg-muted)] rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progressPercentage}%` }}
          ></div>
        </div>
        <p className="text-xs text-[var(--text-muted)] text-right">
          {t("progressPercent", { percent: Math.round(progressPercentage) })}
        </p>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {steps.map((step) => (
          <OnboardingStep
            key={step.id}
            id={step.id}
            checked={onboarding[step.id]}
            onChange={(checked) => handleStepChange(step.id, checked)}
            label={step.label}
            description={step.description}
            linkTo={step.linkTo}
            linkText={step.linkText}
          />
        ))}
      </div>

      {completedSteps === totalSteps && (
        <div className="pt-2 border-t border-[var(--color-border)]">
          <p className="text-sm font-medium text-green-700 text-center">{t("complete")}</p>
        </div>
      )}
    </div>
  );
}
