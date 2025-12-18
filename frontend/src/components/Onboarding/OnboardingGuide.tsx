import { OnboardingState } from '../../types';
import OnboardingStep from './OnboardingStep';

interface OnboardingGuideProps {
  onboarding: OnboardingState;
  onUpdate: (updates: Partial<OnboardingState>) => void;
}

export default function OnboardingGuide({ onboarding, onUpdate }: OnboardingGuideProps) {
  const steps = [
    {
      id: 'flightAdded',
      label: 'Flug anlegen',
      description: 'Fügen Sie Ihren ersten Flug hinzu (manuell oder per Import)',
      linkTo: '/',
      linkText: 'Zum Formular',
    },
    {
      id: 'usedFilter',
      label: 'Filter nutzen',
      description: 'Verwenden Sie die Filter, um Flüge nach verschiedenen Kriterien zu filtern',
      linkTo: '/',
      linkText: 'Filter öffnen',
    },
    {
      id: 'mapExplored',
      label: 'Karte erkunden',
      description: 'Erkunden Sie die interaktive Karte mit Ihren Flugrouten',
      linkTo: '/',
      linkText: 'Zur Karte',
    },
    {
      id: 'statsViewed',
      label: 'Statistiken ansehen',
      description: 'Besuchen Sie die erweiterten Statistiken',
      linkTo: '/stats',
      linkText: 'Zu Statistiken',
    },
    {
      id: 'achievementsViewed',
      label: 'Achievements entdecken',
      description: 'Schauen Sie sich Ihre Achievements und das Leaderboard an',
      linkTo: '/achievements',
      linkText: 'Zu Achievements',
    },
    {
      id: 'exported',
      label: 'Export testen',
      description: 'Testen Sie den Export Ihrer Flugdaten (CSV, GeoJSON, KML)',
      linkTo: '/',
      linkText: 'Export öffnen',
    },
  ];

  const completedSteps = steps.filter((step) => onboarding[step.id as keyof OnboardingState] as boolean).length;
  const totalSteps = steps.length;
  const progressPercentage = (completedSteps / totalSteps) * 100;

  const handleStepChange = (stepId: string, checked: boolean) => {
    onUpdate({ [stepId]: checked } as Partial<OnboardingState>);
  };

  return (
    <div className="card space-y-4 bg-gradient-to-r from-blue-50 to-amber-50 dark:from-gray-800 dark:to-gray-700">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Onboarding</p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            {completedSteps} von {totalSteps} Schritten abgeschlossen
          </p>
        </div>
        <button
          onClick={() => onUpdate({ dismissed: true })}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-xl leading-none"
          aria-label="Onboarding schließen"
        >
          ×
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
          {Math.round(progressPercentage)}% abgeschlossen
        </p>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {steps.map((step) => (
          <OnboardingStep
            key={step.id}
            id={step.id}
            checked={onboarding[step.id as keyof OnboardingState] as boolean}
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
            🎉 Glückwunsch! Sie haben alle Schritte abgeschlossen!
          </p>
        </div>
      )}
    </div>
  );
}





