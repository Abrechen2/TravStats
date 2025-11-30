import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { importsApi } from '../lib/api';

export default function EmailImportPage() {
  const navigate = useNavigate();
  const [emailText, setEmailText] = useState('');
  const [subject, setSubject] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await importsApi.uploadEmail({
        subject: subject || 'Manual Import',
        text: emailText,
      });

      setSuccess('Email erfolgreich importiert! Der Flug ist nun unter "Pending Imports" verfügbar.');
      setEmailText('');
      setSubject('');

      // Redirect to pending imports after 2 seconds
      setTimeout(() => {
        navigate('/');
      }, 2000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Import fehlgeschlagen. Bitte prüfen Sie das Email-Format.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const text = await file.text();

      // Parse .eml file to extract subject and body
      const subjectMatch = text.match(/^Subject:\s*(.+)$/im);
      const extractedSubject = subjectMatch?.[1]?.trim() || file.name;

      // Find email body (after headers, separated by blank line)
      const bodyStart = text.indexOf('\n\n');
      const body = bodyStart !== -1 ? text.substring(bodyStart + 2) : text;

      await importsApi.uploadEmail({
        subject: extractedSubject,
        text: body,
        html: body, // .eml files might have HTML
      });

      setSuccess('Email-Datei erfolgreich importiert! Der Flug ist nun unter "Pending Imports" verfügbar.');

      // Reset file input
      e.target.value = '';

      // Redirect to pending imports after 2 seconds
      setTimeout(() => {
        navigate('/');
      }, 2000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler beim Lesen der Datei. Bitte prüfen Sie das Format.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto px-4 py-8">
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

        {/* Success/Error Messages */}
        {success && (
          <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="text-green-800 dark:text-green-200">{success}</p>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Option 1: Text einfügen */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <div className="flex items-center mb-4">
              <div className="text-3xl mr-3">📝</div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  Text einfügen
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Email-Text direkt kopieren
                </p>
              </div>
            </div>

            <form onSubmit={handleTextSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Betreff (optional)
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="z.B. Buchungsbestätigung Lufthansa"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Email-Inhalt *
                </label>
                <textarea
                  value={emailText}
                  onChange={(e) => setEmailText(e.target.value)}
                  required
                  rows={12}
                  placeholder="Fügen Sie hier den kompletten Email-Text ein...

Beispiel:
Flugnummer: LH123
Von: Frankfurt (FRA)
Nach: München (MUC)
Datum: 15.12.2024
..."
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !emailText.trim()}
                className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors"
              >
                {loading ? 'Wird importiert...' : 'Email importieren'}
              </button>
            </form>
          </div>

          {/* Option 2: Datei hochladen */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <div className="flex items-center mb-4">
              <div className="text-3xl mr-3">📎</div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  Datei hochladen
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  .eml oder .txt Datei hochladen
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center hover:border-blue-500 dark:hover:border-blue-400 transition-colors">
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
                  className={`cursor-pointer ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="text-5xl mb-3">📧</div>
                  <div className="text-gray-700 dark:text-gray-300 font-medium mb-2">
                    {loading ? 'Wird hochgeladen...' : 'Datei auswählen'}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    .eml, .txt oder .msg Dateien
                  </div>
                </label>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  <strong>💡 Tipp:</strong> Sie können Emails in Outlook, Gmail oder Thunderbird als .eml Datei speichern und hier hochladen.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="mt-8 bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            ℹ️ Anleitung
          </h3>
          <div className="space-y-3 text-gray-600 dark:text-gray-400 text-sm">
            <div>
              <strong className="text-gray-900 dark:text-white">Text einfügen:</strong>
              <ol className="list-decimal list-inside mt-2 space-y-1 ml-4">
                <li>Öffnen Sie die Buchungsbestätigung in Ihrem Email-Programm</li>
                <li>Markieren Sie den gesamten Email-Text (Strg+A / Cmd+A)</li>
                <li>Kopieren Sie den Text (Strg+C / Cmd+C)</li>
                <li>Fügen Sie ihn oben in das Textfeld ein</li>
                <li>Klicken Sie auf "Email importieren"</li>
              </ol>
            </div>
            <div>
              <strong className="text-gray-900 dark:text-white">Datei hochladen:</strong>
              <ol className="list-decimal list-inside mt-2 space-y-1 ml-4">
                <li>Öffnen Sie die Email in Ihrem Email-Programm</li>
                <li>Speichern Sie die Email als .eml Datei (meist unter "Datei" → "Speichern als")</li>
                <li>Laden Sie die Datei hier hoch</li>
              </ol>
            </div>
            <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
              <strong className="text-gray-900 dark:text-white">Was passiert danach?</strong>
              <p className="mt-2">
                Der Flug wird automatisch geparst und erscheint unter "Pending Imports" im Dashboard.
                Dort können Sie die Daten überprüfen und den Flug akzeptieren oder ablehnen.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
