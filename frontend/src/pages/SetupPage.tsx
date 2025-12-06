import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setupApi } from '../lib/api';

export default function SetupPage() {
  const navigate = useNavigate();
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
      setError('Username and password are required');
      return;
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
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
            message: 'Please log in with your admin account',
            username: formData.username
          }
        });
      }, 3000);
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { error?: string } } };
      setError(apiError.response?.data?.error || 'Setup failed. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="text-5xl mb-4">🏠</div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              Welcome to TravStats
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Let's set up your self-hosted flight tracker
            </p>
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
            <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
              🔐 Privacy First
            </h3>
            <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
              <li>• Your data stays on YOUR server</li>
              <li>• First user becomes admin automatically</li>
              <li>• Invite family & friends later</li>
              <li>• Designed for 1-10 accounts</li>
            </ul>
          </div>

          {/* Form */}
          {success ? (
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6 text-center">
                <div className="text-5xl mb-4">✅</div>
                <h2 className="text-2xl font-bold text-green-900 dark:text-green-100 mb-2">
                  Setup Complete!
                </h2>
                <p className="text-green-800 dark:text-green-200 mb-4">
                  Admin account <strong>"{formData.username}"</strong> has been created successfully.
                </p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  You will be redirected to the login page in 3 seconds...
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
                Instance Name
              </label>
              <input
                type="text"
                value={formData.instanceName}
                onChange={(e) => setFormData({ ...formData, instanceName: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder="e.g., Smith Family, TravStats"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                This will be shown in the UI
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Admin Username <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder="admin"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Password <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder="••••••••"
                required
                minLength={8}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Minimum 8 characters
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Confirm Password <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder="••••••••"
                required
                minLength={8}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating Admin Account...' : 'Create Admin Account & Complete Setup'}
            </button>
          </form>
          )}

          {/* Footer */}
          <div className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
            <p>Next steps after setup:</p>
            <ul className="mt-2 space-y-1 text-xs">
              <li>1. Log in with your admin account</li>
              <li>2. Add your flights</li>
              <li>3. Invite family & friends via Admin Panel</li>
            </ul>
          </div>
        </div>

        {/* Tips */}
        <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
            💡 Deployment Tips
          </h3>
          <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
            <li>• <strong>Local network:</strong> Access via http://192.168.1.X:3000</li>
            <li>• <strong>VPN/Tailscale:</strong> Secure remote access</li>
            <li>• <strong>Backups:</strong> Run <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">./scripts/backup.sh</code> regularly</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
