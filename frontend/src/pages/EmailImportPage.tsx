import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { importsApi } from '../lib/api';

interface ProcessingStep {
  id: string;
  label: string;
  status: 'pending' | 'loading' | 'success' | 'error';
  icon: string;
  detail?: string;
}

export default function EmailImportPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [processingSteps, setProcessingSteps] = useState<ProcessingStep[]>([]);
  const [parserUsed, setParserUsed] = useState<'ollama' | 'regex' | null>(null);

  const updateStep = (id: string, updates: Partial<ProcessingStep>) => {
    setProcessingSteps((prev) =>
      prev.map((step) => (step.id === id ? { ...step, ...updates } : step))
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setSuccess(null);
    setParserUsed(null);

    // Initialize processing steps
    const steps: ProcessingStep[] = [
      { id: 'upload', label: 'Email wird hochgeladen', status: 'loading', icon: '📤' },
      { id: 'parse', label: 'Email wird analysiert', status: 'pending', icon: '🔍' },
      { id: 'extract', label: 'Flugdaten werden extrahiert', status: 'pending', icon: '✈️' },
      { id: 'complete', label: 'Import abgeschlossen', status: 'pending', icon: '✅' },
    ];
    setProcessingSteps(steps);

    try {
      // Simulate upload step (instant, but show for UX)
      await new Promise((resolve) => setTimeout(resolve, 300));
      updateStep('upload', { status: 'success' });

      // Start parsing step
      updateStep('parse', { status: 'loading' });
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Use FormData for file upload (supports .eml, .txt, .msg)
      const formData = new FormData();
      formData.append('file', file);

      const response = await importsApi.uploadEmailFile(formData);

      // Extract parser info from response (if available)
      const usedOllama = response.parserUsed === 'ollama' || response.usedOllama === true;
      setParserUsed(usedOllama ? 'ollama' : 'regex');

      updateStep('parse', {
        status: 'success',
        detail: usedOllama ? 'KI-Analyse (Ollama)' : 'Regex-Analyse'
      });

      // Extract step
      updateStep('extract', { status: 'loading' });
      await new Promise((resolve) => setTimeout(resolve, 300));
      updateStep('extract', {
        status: 'success',
        detail: `${response.count} Flug${response.count !== 1 ? 'e' : ''} erkannt`
      });

      // Complete step
      updateStep('complete', { status: 'success' });

      setSuccess(`${response.count} Flug${response.count !== 1 ? 'e' : ''} erfolgreich importiert!`);

      // Reset file input
      e.target.value = '';

      // Redirect to pending imports after 3 seconds
      setTimeout(() => {
        navigate('/');
      }, 3000);
    } catch (err: any) {
      const currentStep = steps.find((s) => s.status === 'loading');
      if (currentStep) {
        updateStep(currentStep.id, { status: 'error' });
      }
      setError(err.response?.data?.error || err.response?.data?.message || 'Fehler beim Lesen der Datei. Bitte prüfen Sie das Format.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/')}
            className="text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-flex items-center"
          >
            ← Zurück zum Dashboard
          </button>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Email-Import
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Importieren Sie Flugbuchungen direkt aus Ihren Bestätigungs-Emails
          </p>
        </div>

        {/* Success Message */}
        {success && (
          <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <div className="flex items-center">
              <span className="text-2xl mr-3">✅</span>
              <div>
                <p className="text-green-800 dark:text-green-200 font-semibold">{success}</p>
                {parserUsed && (
                  <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                    {parserUsed === 'ollama' ? '🤖 KI-Analyse mit Ollama erfolgreich' : '📊 Regex-basierte Analyse verwendet'}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-center">
              <span className="text-2xl mr-3">❌</span>
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          </div>
        )}

        {/* Processing Steps */}
        {processingSteps.length > 0 && (
          <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Verarbeitung läuft...
            </h3>
            <div className="space-y-3">
              {processingSteps.map((step) => (
                <div
                  key={step.id}
                  className={`flex items-center p-3 rounded-lg transition-colors ${
                    step.status === 'success'
                      ? 'bg-green-50 dark:bg-green-900/20'
                      : step.status === 'loading'
                      ? 'bg-blue-50 dark:bg-blue-900/20'
                      : step.status === 'error'
                      ? 'bg-red-50 dark:bg-red-900/20'
                      : 'bg-gray-50 dark:bg-gray-700/50'
                  }`}
                >
                  <span className="text-2xl mr-3">{step.icon}</span>
                  <div className="flex-1">
                    <p className={`font-medium ${
                      step.status === 'success'
                        ? 'text-green-800 dark:text-green-200'
                        : step.status === 'loading'
                        ? 'text-blue-800 dark:text-blue-200'
                        : step.status === 'error'
                        ? 'text-red-800 dark:text-red-200'
                        : 'text-gray-600 dark:text-gray-400'
                    }`}>
                      {step.label}
                    </p>
                    {step.detail && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {step.detail}
                      </p>
                    )}
                  </div>
                  {step.status === 'loading' && (
                    <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                  )}
                  {step.status === 'success' && (
                    <span className="text-green-600 dark:text-green-400">✓</span>
                  )}
                  {step.status === 'error' && (
                    <span className="text-red-600 dark:text-red-400">✗</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upload Area */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8">
          <div className="text-center mb-6">
            <div className="text-6xl mb-4">📧</div>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
              Email-Datei hochladen
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              .eml, .txt oder .msg Datei auswählen
            </p>
          </div>

          <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-12 text-center hover:border-blue-500 dark:hover:border-blue-400 transition-colors mb-6">
            <input
              type="file"
              id="email-file"
              accept=".eml,.txt,.msg"
              onChange={handleFileUpload}
              disabled={loading}
              className="hidden"
            />
            <label
              htmlFor="email-file"
              className={`cursor-pointer block ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="text-gray-700 dark:text-gray-300 font-medium text-lg mb-2">
                {loading ? 'Wird verarbeitet...' : 'Datei hier ablegen oder klicken'}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Unterstützte Formate: .eml, .txt, .msg
              </div>
            </label>
          </div>

          {/* Info Boxes */}
          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
              <div className="flex items-start">
                <span className="text-2xl mr-3">💡</span>
                <div>
                  <p className="text-sm text-blue-800 dark:text-blue-200 font-semibold mb-2">
                    So speichern Sie eine Email als Datei:
                  </p>
                  <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                    <li>• <strong>Outlook:</strong> Email öffnen → Datei → Speichern unter → .eml oder .msg</li>
                    <li>• <strong>Gmail:</strong> Email öffnen → Menü (⋮) → Nachricht herunterladen → .eml</li>
                    <li>• <strong>Thunderbird:</strong> Email auswählen → Datei → Speichern unter → .eml</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
              <div className="flex items-start">
                <span className="text-2xl mr-3">🤖</span>
                <div>
                  <p className="text-sm text-purple-800 dark:text-purple-200 font-semibold mb-1">
                    KI-gestützte Analyse
                  </p>
                  <p className="text-sm text-purple-700 dark:text-purple-300">
                    Ihre Email wird automatisch mit Ollama (falls verfügbar) oder Regex-Mustern analysiert,
                    um Flugdaten zu extrahieren. Mehrere Flüge in einer Email werden automatisch erkannt!
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
              <div className="flex items-start">
                <span className="text-2xl mr-3">🔒</span>
                <div>
                  <p className="text-sm text-gray-800 dark:text-gray-200 font-semibold mb-1">
                    Datenschutz
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Ihre Email wird lokal auf dem Server verarbeitet und nach der Analyse gelöscht.
                    Nur die extrahierten Flugdaten werden gespeichert.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* What happens next */}
        <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
            <span className="text-2xl mr-2">📋</span>
            Was passiert als Nächstes?
          </h3>
          <ol className="space-y-3 text-gray-600 dark:text-gray-400 text-sm">
            <li className="flex items-start">
              <span className="text-blue-600 dark:text-blue-400 font-bold mr-3 mt-0.5">1.</span>
              <div>
                <strong className="text-gray-900 dark:text-white">Automatische Extraktion:</strong> Flugdaten werden aus der Email extrahiert
              </div>
            </li>
            <li className="flex items-start">
              <span className="text-blue-600 dark:text-blue-400 font-bold mr-3 mt-0.5">2.</span>
              <div>
                <strong className="text-gray-900 dark:text-white">Pending Imports:</strong> Der Flug erscheint im Dashboard unter "Pending Imports"
              </div>
            </li>
            <li className="flex items-start">
              <span className="text-blue-600 dark:text-blue-400 font-bold mr-3 mt-0.5">3.</span>
              <div>
                <strong className="text-gray-900 dark:text-white">Überprüfung:</strong> Sie können die Daten prüfen und bei Bedarf anpassen
              </div>
            </li>
            <li className="flex items-start">
              <span className="text-blue-600 dark:text-blue-400 font-bold mr-3 mt-0.5">4.</span>
              <div>
                <strong className="text-gray-900 dark:text-white">Bestätigung:</strong> Mit einem Klick wird der Flug zu Ihrer Flughistorie hinzugefügt
              </div>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
