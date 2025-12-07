import { useState, useRef } from 'react';
import { parseApi } from '../lib/api';
import { useThemeStore } from '../store/themeStore';

interface ParsedBooking {
  airline?: string;
  flightNumber?: string;
  departureCode?: string;
  arrivalCode?: string;
  departureTime?: string;
  arrivalTime?: string;
  pnr?: string;
  seat?: string;
  terminal?: string;
  gate?: string;
  price?: string;
  currency?: string;
  aircraft?: string;
  seatClass?: string;
  bookingReference?: string;
  ticketNumber?: string;
  boardingGroup?: string;
  taxes?: string;
  fees?: string;
  missing?: string[];
}

interface EmailUploaderProps {
  onEmailParsed: (
    flights: ParsedBooking[],
    parserUsed: 'ollama' | 'regex' | 'openai' | 'claude'
  ) => void;
  onError: (error: string) => void;
  onClose: () => void;
}

interface ScanStep {
  id: string;
  label: string;
  status: 'pending' | 'loading' | 'success' | 'error';
  icon: string;
  detail?: string;
}

export default function EmailUploader({ onEmailParsed, onError, onClose }: EmailUploaderProps) {
  const [loading, setLoading] = useState(false);
  const [uploadMode, setUploadMode] = useState<'file' | 'text'>('file');
  const [emailText, setEmailText] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [scanSteps, setScanSteps] = useState<ScanStep[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDarkMode = useThemeStore((s) => s.isDarkMode);

  const updateScanStep = (id: string, updates: Partial<ScanStep>) => {
    setScanSteps((prev) =>
      prev.map((step) => (step.id === id ? { ...step, ...updates } : step))
    );
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = async (file: File) => {
    const validExtensions = ['.eml', '.txt', '.msg'];
    const fileExtension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));

    if (!validExtensions.includes(fileExtension)) {
      onError(`Ungültiges Dateiformat: ${fileExtension}. Erlaubt sind: .eml, .txt, .msg`);
      return;
    }

    setLoading(true);

    // Initialize scan steps
    const steps: ScanStep[] = [
      { id: 'extract', label: 'Email-Datei wird extrahiert', status: 'loading', icon: '📧' },
      { id: 'upload', label: 'Upload zum Server', status: 'pending', icon: '📤' },
      { id: 'parse', label: 'KI-Analyse (Ollama/OpenAI/Claude)', status: 'pending', icon: '🤖' },
      { id: 'complete', label: 'Parsing abgeschlossen', status: 'pending', icon: '✅' },
    ];
    setScanSteps(steps);

    try {
      // Step 1: Extract file (handled by browser)
      updateScanStep('extract', { status: 'success', detail: `${file.name} (${fileExtension})` });

      // Step 2: Upload to backend
      updateScanStep('upload', { status: 'loading' });

      // Step 3: Parse with configured parser
      updateScanStep('upload', { status: 'success' });
      updateScanStep('parse', { status: 'loading', detail: 'Email wird analysiert...' });

      const result = await parseApi.parseEmailFile(file);

      if (!result.flights || result.flights.length === 0) {
        updateScanStep('parse', { status: 'error', detail: 'Keine Flüge gefunden' });
        onError('Keine Flüge in der Email gefunden');
        setLoading(false);
        return;
      }

      // Step 4: Success
      updateScanStep('parse', {
        status: 'success',
        detail: `${result.flights.length} Flug/Flüge extrahiert (Parser: ${result.parserUsed})`,
      });
      updateScanStep('complete', { status: 'success' });

      // Wait a bit so user can see success
      await new Promise((resolve) => setTimeout(resolve, 800));

      onEmailParsed(result.flights, result.parserUsed);
      setLoading(false);
      onClose();
    } catch (err: any) {
      console.error('Email parsing error:', err);

      const currentStep = steps.find((s) => s.status === 'loading');
      if (currentStep) {
        updateScanStep(currentStep.id, { status: 'error' });
      }

      onError(err.response?.data?.message || err.message || 'Fehler beim Verarbeiten der Email');
      setLoading(false);
    }
  };

  const handleTextSubmit = async () => {
    if (!emailText.trim()) {
      onError('Bitte geben Sie Email-Inhalt ein');
      return;
    }

    await parseEmailContent(emailText);
  };

  const parseEmailContent = async (content: string, subject?: string) => {
    setLoading(true);

    // Initialize scan steps for text parsing
    const steps: ScanStep[] = [
      { id: 'prepare', label: 'Text wird vorbereitet', status: 'loading', icon: '📝' },
      { id: 'parse', label: 'KI-Analyse (Ollama/OpenAI/Claude)', status: 'pending', icon: '🤖' },
      { id: 'complete', label: 'Parsing abgeschlossen', status: 'pending', icon: '✅' },
    ];
    setScanSteps(steps);

    try {
      // Step 1: Prepare text
      updateScanStep('prepare', { status: 'success', detail: `${content.length} Zeichen` });

      // Step 2: Parse with configured parser
      updateScanStep('parse', { status: 'loading', detail: 'Email wird analysiert...' });

      const result = await parseApi.parseEmail(content, subject);

      if (!result.flights || result.flights.length === 0) {
        updateScanStep('parse', { status: 'error', detail: 'Keine Flüge gefunden' });
        onError('Keine Fluege in der Email gefunden');
        setLoading(false);
        return;
      }

      // Step 3: Success
      updateScanStep('parse', {
        status: 'success',
        detail: `${result.flights.length} Flug/Flüge extrahiert (Parser: ${result.parserUsed})`,
      });
      updateScanStep('complete', { status: 'success' });

      // Wait a bit so user can see success
      await new Promise((resolve) => setTimeout(resolve, 800));

      onEmailParsed(result.flights, result.parserUsed);
      setLoading(false);
      onClose();
    } catch (err: any) {
      console.error('Email text parsing error:', err);

      const currentStep = steps.find((s) => s.status === 'loading');
      if (currentStep) {
        updateScanStep(currentStep.id, { status: 'error' });
      }

      onError(err.response?.data?.message || err.message || 'Fehler beim Parsen der Email');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Email-Import</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            aria-label="Schliessen"
            disabled={loading}
          >
            <span className="sr-only">Schliessen</span>
            ✕
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Advanced Options Toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="showAdvanced"
              checked={showAdvanced}
              onChange={(e) => {
                setShowAdvanced(e.target.checked);
                if (!e.target.checked) setUploadMode('file'); // Reset to file mode when hiding advanced
              }}
              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
              disabled={loading}
            />
            <label
              htmlFor="showAdvanced"
              className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer"
            >
              Erweiterte Optionen anzeigen (Text-Paste)
            </label>
          </div>

          {/* Tab Buttons - Only show if advanced mode is enabled */}
          {showAdvanced && (
            <div className="flex gap-2 border-b dark:border-gray-700">
              <button
                onClick={() => setUploadMode('file')}
                className={`px-4 py-2 font-medium transition-colors ${
                  uploadMode === 'file'
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
                disabled={loading}
              >
                Datei hochladen
              </button>
              <button
                onClick={() => setUploadMode('text')}
                className={`px-4 py-2 font-medium transition-colors ${
                  uploadMode === 'text'
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
                disabled={loading}
              >
                Text einfuegen
              </button>
            </div>
          )}

          {(!showAdvanced || uploadMode === 'file') && (
            <div>
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragActive
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => !loading && fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".eml,.txt,.msg"
                  onChange={handleFileSelect}
                  disabled={loading}
                />

                {!loading && (
                  <div className="space-y-3">
                    <div className="text-5xl" aria-hidden="true">
                      📧
                    </div>
                    <div>
                      <p className="text-lg font-medium text-gray-900 dark:text-white">Email-Datei hier ablegen</p>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">oder klicken zum Auswaehlen</p>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-500">Unterstuetzt: .eml, .txt, .msg</p>
                  </div>
                )}
              </div>

              {/* Scan Steps - Show when processing */}
              {loading && scanSteps.length > 0 && (
                <div className="mt-4 space-y-2">
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

              {!loading && (
                <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-2">🤖 KI-gestützte Analyse</h3>
                  <ul className="text-sm text-blue-800 dark:text-blue-300 space-y-1">
                    <li>• Buchungsbestätigung als .eml/.msg-Datei exportieren</li>
                    <li>• Parser erkennt automatisch alle Flüge (Hin-/Rückflug, Connections)</li>
                    <li>• Fallback-Kette: Ollama/OpenAI/Claude → Regex</li>
                    <li>• Funktioniert mit allen gängigen Airlines</li>
                  </ul>
                </div>
              )}
            </div>
          )}

          {showAdvanced && uploadMode === 'text' && (
            <div className="space-y-4">
              {!loading && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Email-Inhalt einfuegen
                    </label>
                    <textarea
                      value={emailText}
                      onChange={(e) => setEmailText(e.target.value)}
                      className="w-full h-64 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                      placeholder="Kopieren Sie hier den kompletten Email-Text Ihrer Buchungsbestaetigung..."
                      disabled={loading}
                    />
                  </div>

                  <button
                    onClick={handleTextSubmit}
                    disabled={loading || !emailText.trim()}
                    className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Fluege extrahieren
                  </button>

                  <p className="text-xs text-gray-500 dark:text-gray-500 text-center">
                    Tipp: Kopieren Sie die gesamte Email inkl. Header fuer beste Ergebnisse
                  </p>
                </>
              )}

              {/* Scan Steps for Text Mode */}
              {loading && scanSteps.length > 0 && (
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
