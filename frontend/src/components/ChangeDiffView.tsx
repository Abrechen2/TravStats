/**
 * Change Diff View Component
 * 
 * Visual representation of changes between original and proposed data
 */

import { useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { useThemeStore } from '../store/themeStore';

interface ChangeDiffViewProps {
  original: any;
  proposed: any;
  changes: any[];
}

export default function ChangeDiffView({ original, proposed, changes }: ChangeDiffViewProps) {
  const { t } = useTranslation(['pendingUpdates']);
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());

  const toggleField = (field: string) => {
    const newExpanded = new Set(expandedFields);
    if (newExpanded.has(field)) {
      newExpanded.delete(field);
    } else {
      newExpanded.add(field);
    }
    setExpandedFields(newExpanded);
  };

  const getChangeIcon = (type: string) => {
    switch (type) {
      case 'added':
        return (
          <span className="text-green-600 dark:text-green-400 font-bold">+</span>
        );
      case 'removed':
        return (
          <span className="text-red-600 dark:text-red-400 font-bold">−</span>
        );
      case 'changed':
        return (
          <span className="text-yellow-600 dark:text-yellow-400 font-bold">~</span>
        );
      default:
        return null;
    }
  };

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'string' && value.includes('T')) {
      return new Date(value).toLocaleString();
    }
    return String(value);
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
        {t('pendingUpdates:changes.detailed')}
      </h4>
      <div className="space-y-2">
        {changes.map((change, index) => {
          const isExpanded = expandedFields.has(change.field);
          return (
            <div
              key={index}
              className={`border rounded-lg p-3 ${
                isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'
              }`}
            >
              <button
                onClick={() => toggleField(change.field)}
                className="w-full flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-2">
                  {getChangeIcon(change.type)}
                  <span className="font-medium text-gray-900 dark:text-white">
                    {change.field}
                  </span>
                </div>
                <svg
                  className={`w-4 h-4 text-gray-500 transition-transform ${
                    isExpanded ? 'transform rotate-180' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {isExpanded && (
                <div className="mt-3 space-y-2 pt-3 border-t border-gray-300 dark:border-gray-600">
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      {t('pendingUpdates:changes.original')}
                    </div>
                    <div className="text-sm text-red-600 dark:text-red-400 line-through">
                      {formatValue(change.oldValue)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      {t('pendingUpdates:changes.new')}
                    </div>
                    <div className="text-sm text-green-600 dark:text-green-400">
                      {formatValue(change.newValue)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

