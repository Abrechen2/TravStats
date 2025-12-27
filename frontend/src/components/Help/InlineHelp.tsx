import { useState, ReactNode } from 'react';
import { useTranslation } from '../../hooks/useTranslation';

interface InlineHelpProps {
  title: string;
  content: ReactNode;
  category?: 'basic' | 'advanced' | 'expert';
  className?: string;
}

const categoryColors = {
  basic: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700',
  advanced: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700',
  expert: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700',
};

const categoryIcons = {
  basic: '💡',
  advanced: '⚙️',
  expert: '🔧',
};

export default function InlineHelp({
  title,
  content,
  category = 'basic',
  className = '',
}: InlineHelpProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { t } = useTranslation('common');

  return (
    <div className={`rounded-lg border p-4 ${categoryColors[category]} ${className}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          <span className="text-xl">{categoryIcons[category]}</span>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
              {title}
            </h3>
            {isExpanded && (
              <div className="text-sm text-gray-700 dark:text-gray-300 mt-2 space-y-2">
                {content}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="ml-4 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 whitespace-nowrap"
        >
          {isExpanded ? t('help.less') : t('help.more')}
        </button>
      </div>
    </div>
  );
}
















