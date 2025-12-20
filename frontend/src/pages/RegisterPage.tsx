import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useTranslation } from '../hooks/useTranslation';

export default function RegisterPage() {
  const { t } = useTranslation('auth');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError(t('register.passwordsNotMatch'));
      return;
    }

    if (password.length < 6) {
      setError(t('register.passwordTooShort'));
      return;
    }

    setLoading(true);

    try {
      const { user } = await authApi.register(username, password);
      setAuth(user);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.error || t('register.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600">
      <div className="card w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <img src="/logo-with-text.png" alt="TravStats Logo" className="h-24 w-auto mb-4" />
          <h1 className="text-3xl font-bold text-center">TravStats</h1>
        </div>
        <h2 className="text-xl text-gray-600 dark:text-gray-300 text-center mb-8">{t('register.title')}</h2>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="label">{t('register.username')}</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input"
              required
              minLength={3}
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="password" className="label">{t('register.password')}</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              required
              minLength={6}
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="label">{t('register.confirmPassword')}</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="input"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full"
          >
            {loading ? t('register.submitting') : t('register.submit')}
          </button>
        </form>

        <p className="mt-6 text-center text-gray-600 dark:text-gray-400">
          {t('register.hasAccount')}{' '}
          <Link to="/login" className="text-blue-600 dark:text-blue-400 hover:underline">
            {t('register.signIn')}
          </Link>
        </p>
      </div>
    </div>
  );
}
