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
    <div className="card space-y-4 bg-gradient-to-r from-blue-50 to-amber-50 dark:from-gray-800 dark:to-gray-700">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t("title")}</p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            {t("progress", { completed: completedSteps, total: totalSteps })}
          </p>
        </div>
        <button
          onClick={() => onUpdate({ dismissed: true })}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-xl leading-none"
          aria-label={t("dismissAria")}
        >
          x
        </button>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1">
        <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progressPercentage}%` }}
          ></div>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400 text-right">
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
        <div className="pt-2 border-t border-gray-300 dark:border-gray-600">
          <p className="text-sm font-medium text-green-700 dark:text-green-400 text-center">
            {t("complete")}
          </p>
        </div>
      )}
    </div>
  );
}
