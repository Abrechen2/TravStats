/**
 * Pending Update Editor Component
 * 
 * Modal for editing pending updates with live preview
 */

import { useState, useEffect } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { useThemeStore } from '../store/themeStore';
import { pendingUpdatesApi } from '../lib/api';
import { logger } from '../lib/logger';
import StatisticsImpactPreview from './StatisticsImpactPreview';

interface PendingUpdate {
  id: string;
  originalData: any;
  proposedData: any;
  editedData?: any;
}

interface PendingUpdateEditorProps {
  update: PendingUpdate;
  onSave: (editedData: any) => void;
  onCancel: () => void;
}

export default function PendingUpdateEditor({
  update,
  onSave,
  onCancel,
}: PendingUpdateEditorProps) {
  const { t } = useTranslation(['pendingUpdates', 'common']);
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const [editedData, setEditedData] = useState<any>(update.editedData || update.proposedData);
  const [previewImpact, setPreviewImpact] = useState<any>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    loadPreview();
  }, [editedData]);

  const loadPreview = async () => {
    try {
      setLoadingPreview(true);
      const impact = await pendingUpdatesApi.preview(update.id, editedData);
      setPreviewImpact(impact);
    } catch (error) {
      logger.error('Failed to load preview:', error);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleFieldChange = (field: string, value: any) => {
    setEditedData((prev: any) => ({
      ...prev,
      [field]: value || undefined,
    }));
  };

  const handleSave = () => {
    onSave(editedData);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div
        className={`${
          isDarkMode ? 'bg-gray-800' : 'bg-white'
        } rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-auto`}
      >
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              {t('pendingUpdates:editor.title')}
            </h2>
            <button
              onClick={onCancel}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Editor Form */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                {t('pendingUpdates:editor.fields')}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('pendingUpdates:editor.airline')}
                  </label>
                  <input
                    type="text"
                    value={editedData.airline || ''}
                    onChange={(e) => handleFieldChange('airline', e.target.value)}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('pendingUpdates:editor.aircraft')}
                  </label>
                  <input
                    type="text"
                    value={editedData.aircraft || ''}
                    onChange={(e) => handleFieldChange('aircraft', e.target.value)}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('pendingUpdates:editor.gate')}
                  </label>
                  <input
                    type="text"
                    value={editedData.gate || ''}
                    onChange={(e) => handleFieldChange('gate', e.target.value)}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('pendingUpdates:editor.terminal')}
                  </label>
                  <input
                    type="text"
                    value={editedData.terminal || ''}
                    onChange={(e) => handleFieldChange('terminal', e.target.value)}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('pendingUpdates:editor.depIata')}
                  </label>
                  <input
                    type="text"
                    value={editedData.depIata || ''}
                    onChange={(e) => handleFieldChange('depIata', e.target.value)}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('pendingUpdates:editor.arrIata')}
                  </label>
                  <input
                    type="text"
                    value={editedData.arrIata || ''}
                    onChange={(e) => handleFieldChange('arrIata', e.target.value)}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('pendingUpdates:editor.departureTime')}
                  </label>
                  <input
                    type="datetime-local"
                    value={
                      editedData.departureTime
                        ? new Date(editedData.departureTime).toISOString().slice(0, 16)
                        : ''
                    }
                    onChange={(e) =>
                      handleFieldChange('departureTime', e.target.value ? new Date(e.target.value).toISOString() : null)
                    }
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('pendingUpdates:editor.arrivalTime')}
                  </label>
                  <input
                    type="datetime-local"
                    value={
                      editedData.arrivalTime
                        ? new Date(editedData.arrivalTime).toISOString().slice(0, 16)
                        : ''
                    }
                    onChange={(e) =>
                      handleFieldChange('arrivalTime', e.target.value ? new Date(e.target.value).toISOString() : null)
                    }
                    className="input w-full"
                  />
                </div>
              </div>
            </div>

            {/* Preview */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                {t('pendingUpdates:editor.preview')}
              </h3>
              {loadingPreview ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : (
                <StatisticsImpactPreview impact={previewImpact} />
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              {t('common:cancel')}
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t('pendingUpdates:editor.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

