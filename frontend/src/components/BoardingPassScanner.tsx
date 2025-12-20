import { useState, useRef } from 'react';
import { parseApi } from '../lib/api';
import { useThemeStore } from '../store/themeStore';
import { useTranslation } from '../hooks/useTranslation';

interface BoardingPassScannerProps {
  onScanSuccess: (data: any) => void; // ParsedBooking from Ollama
  onClose: () => void;
}

interface ScanStep {
  id: string;
  label: string;
  status: 'pending' | 'loading' | 'success' | 'error';
  icon: string;
  detail?: string;
}

export default function BoardingPassScanner({ onScanSuccess, onClose }: BoardingPassScannerProps) {
  const { t } = useTranslation(['flights', 'common', 'errors']);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [scanSteps, setScanSteps] = useState<ScanStep[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDarkMode = useThemeStore((s) => s.isDarkMode);

  const updateScanStep = (id: string, updates: Partial<ScanStep>) => {
    setScanSteps((prev) =>
      prev.map((step) => (step.id === id ? { ...step, ...updates } : step))
    );
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setScanning(true);

    // Initialize scan steps
    const steps: ScanStep[] = [
      { id: 'load', label: t('flights:scanner.steps.load'), status: 'loading', icon: '📸' },
      { id: 'upload', label: t('flights:scanner.steps.upload'), status: 'pending', icon: '📤' },
      { id: 'ollama', label: t('flights:scanner.steps.ollama'), status: 'pending', icon: '🤖' },
      { id: 'api', label: t('flights:scanner.steps.api'), status: 'pending', icon: '🔍' },
      { id: 'complete', label: t('flights:scanner.steps.complete'), status: 'pending', icon: '✅' },
    ];
    setScanSteps(steps);

    try {
      // Step 1: Load image
      const reader = new FileReader();
      reader.onload = async (event) => {
        const dataUrl = event.target?.result as string;
        setPreview(dataUrl);
        updateScanStep('load', { status: 'success' });

        // Step 2: Convert to base64 (remove data:image/...;base64, prefix)
        updateScanStep('upload', { status: 'loading' });
        const base64Data = dataUrl.split(',')[1];

        try {
          // Step 3: Send to Ollama Vision API
          updateScanStep('upload', { status: 'success' });
          updateScanStep('ollama', { status: 'loading', detail: t('flights:scanner.analyzing') });

          const result = await parseApi.parseBoardingpass(base64Data, true); // enrichWithApi = true

          updateScanStep('ollama', {
            status: 'success',
            detail: `${result.flight.flightNumber || t('flights:scanner.flight')} ${result.flight.departureCode} ${t('common:labels.routeSeparator')} ${result.flight.arrivalCode}`,
          });

          // Step 4: API enrichment status
          if (result.enriched) {
            updateScanStep('api', { status: 'success', detail: t('flights:scanner.enriched') });
          } else {
            updateScanStep('api', { status: 'success', detail: t('flights:scanner.noEnrichment') });
          }

          // Step 5: Complete
          updateScanStep('complete', { status: 'success' });

          // Wait a bit so user can see success
          await new Promise((resolve) => setTimeout(resolve, 800));

          // Return parsed data
          onScanSuccess(result.flight);
        } catch (err: any) {
          console.error('Boarding pass parsing failed:', err);

          const currentStep = steps.find((s) => s.status === 'loading');
          if (currentStep) {
            updateScanStep(currentStep.id, { status: 'error' });
          }

          if (err.response?.status === 503) {
            setError(t('flights:scanner.ollamaUnavailable'));
          } else {
            setError(err.response?.data?.error || err.message || t('errors:boardingPassError'));
          }

          setScanning(false);
        }
      };

      reader.onerror = () => {
        updateScanStep('load', { status: 'error' });
        setError(t('flights:scanner.loadError'));
        setScanning(false);
      };

      reader.readAsDataURL(file);
    } catch (err: any) {
      setError(t('flights:scanner.processError'));
      setScanning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto`}>
        {/* Header */}
        <div className={`sticky top-0 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} border-b px-6 py-4 flex items-center justify-between`}>
          <h2 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            {t('flights:scanner.title')}
          </h2>
          <button
            onClick={onClose}
            disabled={scanning}
            className={`p-2 ${isDarkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'} rounded-lg transition-colors`}
            aria-label={t('common:buttons.close')}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {error && (
            <div className={`p-4 ${isDarkMode ? 'bg-red-900/20 border-red-800' : 'bg-red-50 border-red-200'} border rounded-lg`}>
              <div className="flex items-start">
                <span className="text-2xl mr-3">❌</span>
                <p className={`${isDarkMode ? 'text-red-200' : 'text-red-800'}`}>{error}</p>
              </div>
            </div>
          )}

          {/* Upload Area */}
          {!scanning && !preview && (
            <div>
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  isDarkMode
                    ? 'border-gray-600 hover:border-gray-500 bg-gray-750'
                    : 'border-gray-300 hover:border-gray-400 bg-gray-50'
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={handleFileSelect}
                />
                <div className="space-y-3">
                  <div className="text-5xl">🎫</div>
                  <div>
                    <p className={`text-lg font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {t('flights:scanner.uploadTitle')}
                    </p>
                    <p className={`text-sm mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      {t('flights:scanner.clickToSelect')}
                    </p>
                  </div>
                  <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                    {t('flights:scanner.supportedFormats')}
                  </p>
                </div>
              </div>

              {/* Info Box */}
              <div className={`mt-4 p-4 ${isDarkMode ? 'bg-blue-900/20 border-blue-800' : 'bg-blue-50 border-blue-200'} border rounded-lg`}>
                <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-blue-200' : 'text-blue-900'} mb-2`}>
                  🤖 {t('flights:scanner.info.title')}
                </h3>
                <ul className={`text-sm ${isDarkMode ? 'text-blue-300' : 'text-blue-800'} space-y-1`}>
                  <li>• {t('flights:scanner.info.step1')}</li>
                  <li>• {t('flights:scanner.info.step2')}</li>
                  <li>• {t('flights:scanner.info.step3')}</li>
                  <li>• {t('flights:scanner.info.step4')}</li>
                </ul>
              </div>
            </div>
          )}

          {/* Preview & Progress */}
          {preview && (
            <div className="space-y-4">
              {/* Image Preview */}
              <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-2">
                <img
                  src={preview}
                  alt={t('flights:scanner.previewAlt')}
                  className="max-w-full max-h-64 mx-auto object-contain rounded"
                />
              </div>

              {/* Scan Steps */}
              {scanSteps.length > 0 && (
                <div className="space-y-2">
                  {scanSteps.map((step) => (
                    <div
                      key={step.id}
                      className={`flex items-center gap-3 p-3 rounded-lg ${
                        step.status === 'success'
                          ? isDarkMode
                            ? 'bg-green-900/20 border border-green-800'
                            : 'bg-green-50 border border-green-200'
                          : step.status === 'error'
                          ? isDarkMode
                            ? 'bg-red-900/20 border border-red-800'
                            : 'bg-red-50 border border-red-200'
                          : step.status === 'loading'
                          ? isDarkMode
                            ? 'bg-blue-900/20 border border-blue-800'
                            : 'bg-blue-50 border border-blue-200'
                          : isDarkMode
                          ? 'bg-gray-750 border border-gray-700'
                          : 'bg-gray-50 border border-gray-200'
                      }`}
                    >
                      <span className="text-2xl">{step.icon}</span>
                      <div className="flex-1">
                        <p
                          className={`font-medium ${
                            step.status === 'success'
                              ? isDarkMode
                                ? 'text-green-200'
                                : 'text-green-800'
                              : step.status === 'error'
                              ? isDarkMode
                                ? 'text-red-200'
                                : 'text-red-800'
                              : step.status === 'loading'
                              ? isDarkMode
                                ? 'text-blue-200'
                                : 'text-blue-800'
                              : isDarkMode
                              ? 'text-gray-400'
                              : 'text-gray-600'
                          }`}
                        >
                          {step.label}
                        </p>
                        {step.detail && (
                          <p
                            className={`text-sm ${
                              step.status === 'success'
                                ? isDarkMode
                                  ? 'text-green-300'
                                  : 'text-green-700'
                                : step.status === 'error'
                                ? isDarkMode
                                  ? 'text-red-300'
                                  : 'text-red-700'
                                : isDarkMode
                                ? 'text-blue-300'
                                : 'text-blue-700'
                            }`}
                          >
                            {step.detail}
                          </p>
                        )}
                      </div>
                      {step.status === 'loading' && (
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
