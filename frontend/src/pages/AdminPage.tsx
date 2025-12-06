import { useState, useEffect } from 'react';
import { adminApi } from '../lib/api';
import { format } from 'date-fns';

export default function AdminPage() {
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [parserSettings, setParserSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'invitations' | 'system' | 'parsers'>('system');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [savingParsers, setSavingParsers] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [infoData, usersData, invitationsData, parserData] = await Promise.all([
        adminApi.getSystemInfo(),
        adminApi.getUsers(),
        adminApi.getInvitations(),
        adminApi.getAdminParserSettings(),
      ]);
      setSystemInfo(infoData);
      setUsers(usersData.users);
      setInvitations(invitationsData.invitations);
      setParserSettings(parserData);
    } catch (error) {
      console.error('Failed to load admin data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleUserActive = async (userId: string) => {
    try {
      await adminApi.toggleUserActive(userId);
      await loadData(); // Reload
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to update user');
    }
  };

  const handleCreateInvitation = async () => {
    const email = prompt('Enter email (optional):');
    try {
      const { inviteUrl } = await adminApi.createInvitation(email || undefined, 7);
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 3000);
      alert(`Invitation link copied to clipboard!\n\n${inviteUrl}`);
      await loadData(); // Reload
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to create invitation');
    }
  };

  const handleExportData = async () => {
    if (!confirm('Export all data? This will download a JSON file with all user data.')) {
      return;
    }

    try {
      const data = await adminApi.exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `travstats-backup-${new Date().toISOString()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to export data');
    }
  };

  const handleSaveParserSettings = async () => {
    setSavingParsers(true);
    try {
      await adminApi.updateAdminParserSettings(parserSettings);
      alert('Parser settings saved successfully!');
    } catch (error: any) {
      console.error('Failed to save parser settings:', error);
      alert(error.response?.data?.error || 'Failed to save parser settings');
    } finally {
      setSavingParsers(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600 dark:text-gray-400">Loading admin panel...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          ⚙️ Admin Panel
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Manage your self-hosted TravStats instance
        </p>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setActiveTab('system')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'system'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          System Info
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'users'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          Users ({users.length})
        </button>
        <button
          onClick={() => setActiveTab('invitations')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'invitations'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          Invitations
        </button>
        <button
          onClick={() => setActiveTab('parsers')}
          className={`px-4 py-2 font-medium transition ${
            activeTab === 'parsers'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          Parser Settings
        </button>
      </div>

      {/* System Info Tab */}
      {activeTab === 'system' && systemInfo && (
        <div className="space-y-6">
          {/* Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="text-gray-600 dark:text-gray-400 text-sm mb-1">Instance</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {systemInfo.instanceName}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="text-gray-600 dark:text-gray-400 text-sm mb-1">Total Users</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {systemInfo.userCount} / {systemInfo.maxUsers}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="text-gray-600 dark:text-gray-400 text-sm mb-1">Active Users</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {systemInfo.activeUserCount}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="text-gray-600 dark:text-gray-400 text-sm mb-1">Total Flights</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {systemInfo.flightCount}
              </div>
            </div>
          </div>

          {/* Warning */}
          {systemInfo.warningThreshold && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <h3 className="font-semibold text-yellow-900 dark:text-yellow-100 mb-2">
                ⚠️ User Limit Warning
              </h3>
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                You have reached the recommended user limit ({systemInfo.maxUsers} users).
                Performance may be affected with more users. Consider the system's capacity.
              </p>
            </div>
          )}

          {/* Demo User Warning */}
          {systemInfo.demoUserExists && systemInfo.demoUserActive && (
            <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
              <h3 className="font-semibold text-orange-900 dark:text-orange-100 mb-2">
                🔓 Demo User Active
              </h3>
              <p className="text-sm text-orange-800 dark:text-orange-200 mb-3">
                The demo user account (username: "demo", password: "demo123") is currently active.
                This is a security risk in production environments. It is recommended to deactivate
                this account after initial testing.
              </p>
              <button
                onClick={() => {
                  const demoUser = users.find(u => u.username === 'demo');
                  if (demoUser && confirm('Deactivate the demo user account? This will prevent login with demo credentials.')) {
                    handleToggleUserActive(demoUser.id);
                  }
                }}
                className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg transition text-sm font-medium"
              >
                Deactivate Demo User
              </button>
            </div>
          )}

          {/* Configuration */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Configuration
            </h2>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <dt className="text-sm text-gray-600 dark:text-gray-400">Registration</dt>
                <dd className="text-lg font-medium text-gray-900 dark:text-white">
                  {systemInfo.registrationEnabled ? '✅ Enabled' : '❌ Disabled'}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-600 dark:text-gray-400">Version</dt>
                <dd className="text-lg font-medium text-gray-900 dark:text-white">
                  {systemInfo.version}
                </dd>
              </div>
            </dl>
          </div>

          {/* Actions */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Data Management
            </h2>
            <button
              onClick={handleExportData}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
            >
              📥 Download Full Backup (JSON)
            </button>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
              Export all user data for backup purposes (GDPR compliant)
            </p>
          </div>
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Username
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Flights
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Achievements
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {user.username}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {format(new Date(user.createdAt), 'MMM d, yyyy')}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {user._count.flights}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {user._count.userAchievements}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {user.isAdmin ? (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
                          Admin
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                          User
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {user.isActive ? (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        onClick={() => handleToggleUserActive(user.id)}
                        className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        {user.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invitations Tab */}
      {activeTab === 'invitations' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Invitation Links
            </h2>
            <button
              onClick={handleCreateInvitation}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
            >
              + Create Invitation
            </button>
          </div>

          {copiedUrl && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-green-800 dark:text-green-200 text-sm">
              ✅ Invitation link copied to clipboard!
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Created By
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Expires
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {invitation.email || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {invitation.creator.username}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {format(new Date(invitation.expiresAt), 'MMM d, yyyy')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {invitation.usedAt ? (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                          Used on {format(new Date(invitation.usedAt), 'MMM d')}
                        </span>
                      ) : new Date(invitation.expiresAt) < new Date() ? (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                          Expired
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                          Active
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Parser Settings Tab */}
      {activeTab === 'parsers' && parserSettings && (
        <div className="space-y-6">
          {/* Header with Save Button */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Global Parser Configuration
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Configure default parser settings and API keys for all users
              </p>
            </div>
            <button
              onClick={handleSaveParserSettings}
              disabled={savingParsers}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg transition font-medium"
            >
              {savingParsers ? 'Saving...' : 'Save Settings'}
            </button>
          </div>

          {/* Global API Keys */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Global API Keys
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              These API keys will be used system-wide unless users provide their own keys (if allowed below).
              Keys are encrypted at the application level.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  OpenAI API Key
                </label>
                <input
                  type="password"
                  value={parserSettings.globalOpenaiApiKey || ''}
                  onChange={(e) => setParserSettings({ ...parserSettings, globalOpenaiApiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white font-mono text-sm"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Get from{' '}
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    platform.openai.com
                  </a>
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Claude API Key
                </label>
                <input
                  type="password"
                  value={parserSettings.globalClaudeApiKey || ''}
                  onChange={(e) => setParserSettings({ ...parserSettings, globalClaudeApiKey: e.target.value })}
                  placeholder="sk-ant-..."
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white font-mono text-sm"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Get from{' '}
                  <a
                    href="https://console.anthropic.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    console.anthropic.com
                  </a>
                </p>
              </div>
            </div>
          </div>

          {/* User Permissions */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              User Permissions
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Control whether users can provide their own API keys for cloud-based parsers.
            </p>
            <div className="space-y-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={parserSettings.allowUserApiKeys}
                  onChange={(e) => setParserSettings({ ...parserSettings, allowUserApiKeys: e.target.checked })}
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">
                    Allow users to provide their own API keys
                  </span>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Users can enter their own OpenAI/Claude API keys in their settings. Their keys will take precedence over global keys.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={parserSettings.requireUserApiKeys}
                  onChange={(e) => setParserSettings({ ...parserSettings, requireUserApiKeys: e.target.checked })}
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">
                    Require users to provide their own API keys
                  </span>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Force users to provide their own API keys. Global keys will not be used. Only free parsers (Ollama, Tesseract, Regex) will work without user keys.
                  </p>
                </div>
              </label>
            </div>

            {parserSettings.requireUserApiKeys && !parserSettings.allowUserApiKeys && (
              <div className="mt-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  ⚠️ Warning: You have enabled "Require user API keys" but disabled "Allow user API keys".
                  This means users cannot use cloud-based parsers (OpenAI, Claude).
                </p>
              </div>
            )}
          </div>

          {/* Default Parser Settings */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Default Parser Settings
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              These defaults will be applied to new user accounts. Users can change them in their settings.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Default Vision Parser (Boarding Pass)
                </label>
                <select
                  value={parserSettings.defaultVisionParser}
                  onChange={(e) => setParserSettings({ ...parserSettings, defaultVisionParser: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
                >
                  <option value="auto">🤖 Auto (Recommended)</option>
                  <option value="ollama">🖥️ Ollama Vision</option>
                  <option value="openai">☁️ OpenAI GPT-4 Vision</option>
                  <option value="claude">☁️ Claude 3.5 Vision</option>
                  <option value="tesseract">📝 Tesseract OCR</option>
                  <option value="manual">✋ Manual Entry</option>
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Auto mode automatically selects the best available parser
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Default Text Parser (Email)
                </label>
                <select
                  value={parserSettings.defaultTextParser}
                  onChange={(e) => setParserSettings({ ...parserSettings, defaultTextParser: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
                >
                  <option value="auto">🤖 Auto (Recommended)</option>
                  <option value="ollama">🖥️ Ollama</option>
                  <option value="openai">☁️ OpenAI GPT-4</option>
                  <option value="claude">☁️ Claude 3.5</option>
                  <option value="regex">🔤 Regex Fallback</option>
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Auto mode automatically selects the best available parser
                </p>
              </div>
            </div>
          </div>

          {/* Help Section */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <div className="text-sm text-blue-900 dark:text-blue-100">
                <p className="font-medium mb-2">Parser Configuration Guide</p>
                <ul className="space-y-1 text-xs">
                  <li>• <strong>Free Options</strong>: Ollama (local AI, GPU recommended), Tesseract (OCR), Regex (pattern matching)</li>
                  <li>• <strong>Cloud Options</strong>: OpenAI (~$0.01-0.05/image, $0.002-0.01/email), Claude (~$0.01-0.03/image, $0.003-0.015/email)</li>
                  <li>• <strong>Auto Mode</strong>: System prioritizes cloud AI &gt; local AI &gt; OCR/regex based on availability</li>
                  <li>• <strong>API Keys</strong>: Global keys are shared across all users unless users provide their own</li>
                  <li>• <strong>Fallback Chain</strong>: Users can configure custom fallback sequences in their settings</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
