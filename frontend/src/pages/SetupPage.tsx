import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setupApi } from '../lib/api';
import { useTranslation } from '../hooks/useTranslation';

export default function SetupPage() {
  const navigate = useNavigate();
  const { t } = useTranslation(['setup', 'common']);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    instanceName: 'TravStats',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!formData.username || !formData.password) {
      setError(t('setup:validation.usernamePasswordRequired'));
      return;
    }

    if (formData.password.length < 8) {
      setError(t('setup:validation.passwordTooShort'));
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError(t('setup:validation.passwordsDoNotMatch'));
      return;
    }

    setLoading(true);

    try {
      await setupApi.initialize(
        formData.username,
        formData.password,
        formData.instanceName
      );

      // Show success state
      setSuccess(true);
      setLoading(false);

      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate('/login', {
          state: {
            message: t('setup:loginPrompt'),
            username: formData.username
          }
        });
      }, 3000);
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { error?: string } } };
      setError(apiError.response?.data?.error || t('setup:errors.failed'));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="text-5xl mb-4">✈️</div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              {t('setup:title', { appName: t('common:app.name') })}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {t('setup:subtitle')}
            </p>
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
            <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
              🔒 {t('setup:privacy.title')}
            </h3>
            <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
              <li>- {t('setup:privacy.items.dataStays')}</li>
              <li>- {t('setup:privacy.items.firstUserAdmin')}</li>
              <li>- {t('setup:privacy.items.inviteLater')}</li>
              <li>- {t('setup:privacy.items.designedFor')}</li>
            </ul>
          </div>

          {/* Form */}
          {success ? (
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6 text-center">
                <div className="text-5xl mb-4">✅</div>
                <h2 className="text-2xl font-bold text-green-900 dark:text-green-100 mb-2">
                  {t('setup:success.title')}
                </h2>
                <p className="text-green-800 dark:text-green-200 mb-4">
                  {t('setup:success.adminCreated', { username: formData.username })}
                </p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  {t('setup:success.redirecting')}
                </p>
              </div>
            </div>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-red-800 dark:text-red-200 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('setup:form.instanceName.label')}
              </label>
              <input
                type="text"
                value={formData.instanceName}
                onChange={(e) => setFormData({ ...formData, instanceName: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder={t('setup:form.instanceName.placeholder')}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('setup:form.instanceName.help')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('setup:form.adminUsername.label')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder={t('setup:form.adminUsername.placeholder')}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('setup:form.password.label')} <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder={t('setup:form.password.placeholder')}
                required
                minLength={8}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('setup:form.password.help')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('setup:form.confirmPassword.label')} <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder={t('setup:form.confirmPassword.placeholder')}
                required
                minLength={8}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? t('setup:form.submit.creating') : t('setup:form.submit.create')}
            </button>
          </form>
          )}

          {/* Footer */}
          <div className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
            <p>{t('setup:footer.title')}</p>
            <ul className="mt-2 space-y-1 text-xs">
              <li>1. {t('setup:footer.steps.one')}</li>
              <li>2. {t('setup:footer.steps.two')}</li>
              <li>3. {t('setup:footer.steps.three')}</li>
            </ul>
          </div>
        </div>

        {/* Tips */}
        <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
            💡 {t('setup:tips.title')}
          </h3>
          <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
            <li>
              - <strong>{t('setup:tips.items.localNetwork.label')}:</strong>{' '}
              {t('setup:tips.items.localNetwork.value')}
            </li>
            <li>
              - <strong>{t('setup:tips.items.vpn.label')}:</strong>{' '}
              {t('setup:tips.items.vpn.value')}
            </li>
            <li>
              - <strong>{t('setup:tips.items.backups.label')}:</strong>{' '}
              {t('setup:tips.items.backups.value', { command: './scripts/backup.sh' })}
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
