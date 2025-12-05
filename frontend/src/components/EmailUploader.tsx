import { useState, useRef } from 'react';
import { API_URL } from '../lib/api';

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
  onEmailParsed: (flights: ParsedBooking[], parserUsed: 'ollama' | 'regex') => void;
  onError: (error: string) => void;
  onClose: () => void;
}

export default function EmailUploader({ onEmailParsed, onError, onClose }: EmailUploaderProps) {
  const [loading, setLoading] = useState(false);
  const [uploadMode, setUploadMode] = useState<'file' | 'text'>('file');
  const [emailText, setEmailText] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    try {
      // Read file and parse with new parse-email API
      const reader = new FileReader();
      reader.onload = async (e) => {
        const content = e.target?.result as string;
        await parseEmailContent(content, file.name);
      };
      reader.onerror = () => {
        onError('Fehler beim Lesen der Datei');
        setLoading(false);
      };
      reader.readAsText(file);
    } catch (err: any) {
      onError(err.message || 'Fehler beim Verarbeiten der Datei');
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

    try {
      const response = await fetch(`${API_URL}/api/v1/parse-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          emailContent: content,
          subject,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Parsing fehlgeschlagen');
      }

      const data = await response.json();

      if (!data.flights || data.flights.length === 0) {
        onError('Keine Flüge in der Email gefunden');
        setLoading(false);
        return;
      }

      // Success - call callback with parsed flights
      onEmailParsed(data.flights, data.parserUsed);
    } catch (err: any) {
      onError(err.message || 'Fehler beim Parsen der Email');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Email-Import
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            aria-label="Schließen"
            disabled={loading}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Mode Toggle */}
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
              📎 Datei hochladen
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
              📝 Text einfügen
            </button>
          </div>

          {/* File Upload Mode */}
          {uploadMode === 'file' && (
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

                {loading ? (
                  <div className="space-y-3">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="text-gray-600 dark:text-gray-400">
                      Email wird verarbeitet...
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-500">
                      Dies kann einige Sekunden dauern
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-5xl">📧</div>
                    <div>
                      <p className="text-lg font-medium text-gray-900 dark:text-white">
                        Email-Datei hier ablegen
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        oder klicken zum Auswählen
                      </p>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-500">
                      Unterstützt: .eml, .txt, .msg
                    </p>
                  </div>
                )}
              </div>

              {/* Info Box */}
              <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-2">
                  💡 So funktioniert's
                </h3>
                <ul className="text-sm text-blue-800 dark:text-blue-300 space-y-1">
                  <li>• Buchungsbestätigung als .eml-Datei aus Email-Client exportieren</li>
                  <li>• Oder Email-Text als .txt speichern</li>
                  <li>• Ollama extrahiert automatisch Flugdaten (oder Regex als Fallback)</li>
                  <li>• Mehrere Flüge (Hin-/Rückflug) werden einzeln erkannt</li>
                </ul>
              </div>
            </div>
          )}

          {/* Text Paste Mode */}
          {uploadMode === 'text' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Email-Inhalt einfügen
                </label>
                <textarea
                  value={emailText}
                  onChange={(e) => setEmailText(e.target.value)}
                  className="w-full h-64 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  placeholder="Kopieren Sie hier den kompletten Email-Text Ihrer Buchungsbestätigung..."
                  disabled={loading}
                />
              </div>

              <button
                onClick={handleTextSubmit}
                disabled={loading || !emailText.trim()}
                className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Verarbeite Email...
                  </span>
                ) : (
                  '🔍 Flüge extrahieren'
                )}
              </button>

              {/* Info */}
              <p className="text-xs text-gray-500 dark:text-gray-500 text-center">
                Tipp: Kopieren Sie die gesamte Email inkl. Header für beste Ergebnisse
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
