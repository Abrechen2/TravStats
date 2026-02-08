import { useEffect, useState } from 'react';
import { achievementsApi } from '../lib/api';
import ContextualHint from '../components/Onboarding/ContextualHint';
import NavigationBar from '../components/NavigationBar';
import type { Achievement, AchievementSummary, LeaderboardEntry } from '../types';
import { STORAGE_KEYS } from '../lib/constants';
import { useTranslation } from '../hooks/useTranslation';
import { logger } from '../lib/logger';

const tierColors = {
  bronze: 'from-amber-700 to-amber-900',
  silver: 'from-gray-400 to-gray-600',
  gold: 'from-yellow-400 to-yellow-600',
  platinum: 'from-cyan-400 to-blue-500',
  diamond: 'from-purple-400 to-pink-500',
};

const tierTextColors = {
  bronze: 'text-amber-400',
  silver: 'text-gray-300',
  gold: 'text-yellow-400',
  platinum: 'text-cyan-400',
  diamond: 'text-purple-400',
};

export default function AchievementsPage(): JSX.Element {
  const { t } = useTranslation(['achievements', 'common']);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [summary, setSummary] = useState<AchievementSummary | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [showUnlockedOnly, setShowUnlockedOnly] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  const categoryNames: Record<string, string> = {
    explorer: t('achievements:categories.explorer'),
    distance: t('achievements:categories.distance'),
    collector: t('achievements:categories.collector'),
    elite: t('achievements:categories.elite'),
    special: t('achievements:categories.special'),
  };

  useEffect(() => {
    loadAchievements();
    loadLeaderboard();
    // Mark achievements as viewed in onboarding
    const onboarding = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.ONBOARDING_CHECKLIST) || '{}'
    );
    if (!onboarding.achievementsViewed) {
      onboarding.achievementsViewed = true;
      localStorage.setItem(STORAGE_KEYS.ONBOARDING_CHECKLIST, JSON.stringify(onboarding));
    }
  }, []);

  const loadAchievements = async () => {
    try {
      setLoading(true);
      const data = await achievementsApi.getAll();
      setAchievements(data.achievements);
      setSummary(data.summary);
    } catch (error) {
      logger.error('Failed to load achievements:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadLeaderboard = async () => {
    try {
      const data = await achievementsApi.getLeaderboard(20);
      setLeaderboard(data.leaderboard);
    } catch (error) {
      logger.error('Failed to load leaderboard:', error);
    }
  };

  const handleCheckAchievements = async () => {
    try {
      const result = await achievementsApi.checkAchievements();
      if (result.newlyUnlocked > 0) {
        alert(t('achievements:alerts.unlocked', { count: result.newlyUnlocked }));
        loadAchievements();
      } else {
        alert(t('achievements:alerts.none'));
      }
    } catch (error) {
      logger.error('Failed to check achievements:', error);
    }
  };

  const filteredAchievements = achievements.filter((ach) => {
    if (selectedCategory !== 'all' && ach.category !== selectedCategory) return false;
    if (selectedTier !== 'all' && ach.tier !== selectedTier) return false;
    if (showUnlockedOnly && !ach.isUnlocked) return false;
    return true;
  });

  const groupedAchievements = filteredAchievements.reduce((acc, ach) => {
    if (!acc[ach.category]) {
      acc[ach.category] = [];
    }
    acc[ach.category].push(ach);
    return acc;
  }, {} as Record<string, Achievement[]>);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">{t('achievements:loading')}</div>
      </div>
    );
  }

  if (showLeaderboard) {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <NavigationBar />
        <div className="p-6">
          <div className="max-w-6xl mx-auto">
            <ContextualHint
              id="achievements-page-hint"
              title={t('achievements:hint.title')}
              message={t('achievements:hint.message')}
              linkTo="/"
              linkText={t('achievements:hint.linkText')}
            />
            <div className="flex items-center gap-4 mb-6">
              <button
                onClick={() => setShowLeaderboard(false)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                {t('achievements:leaderboard.backToAchievements')}
              </button>
              <h1 className="text-4xl font-bold">🏆 {t('achievements:leaderboard.title')}</h1>
            </div>

            <div className="bg-gray-800 rounded-xl p-6">
              {leaderboard.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4">🏆</div>
                  <h3 className="text-2xl font-bold text-white mb-2">
                    {t('achievements:leaderboard.emptyTitle')}
                  </h3>
                  <p className="text-gray-400">
                    {t('achievements:leaderboard.emptyMessage')}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {leaderboard.map((entry) => (
                    <div
                      key={entry.rank}
                      className="flex items-center gap-4 p-4 bg-gray-700 rounded-lg hover:bg-gray-650 transition-colors"
                    >
                      <div
                        className={`text-3xl font-bold w-12 text-center ${entry.rank === 1
                            ? 'text-yellow-400'
                            : entry.rank === 2
                              ? 'text-gray-400'
                              : entry.rank === 3
                                ? 'text-amber-600'
                                : 'text-gray-500'
                          }`}
                      >
                        {entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `#${entry.rank}`}
                      </div>
                      <div className="flex-1">
                        <div className="text-xl font-semibold">{entry.username}</div>
                        <div className="text-sm text-gray-400">
                          {t('achievements:leaderboard.achievementCount', { count: entry.achievementCount })}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-yellow-400">
                          {entry.totalPoints.toLocaleString()}
                        </div>
                        <div className="text-sm text-gray-400">
                          {t('achievements:leaderboard.points')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <NavigationBar />
      <div className="p-6">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-4xl font-bold">🏆 {t('achievements:title')}</h1>
          </div>

          <ContextualHint
            id="achievements-page-hint"
            title={t('achievements:hint.title')}
            message={t('achievements:hint.message')}
            linkTo="/"
            linkText={t('achievements:hint.linkText')}
          />

          {/* Summary Stats */}
          {summary && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl p-6">
                <div className="text-sm text-blue-200 mb-1">{t('achievements:summary.totalPoints')}</div>
                <div className="text-3xl font-bold">{summary.totalPoints.toLocaleString()}</div>
              </div>
              <div className="bg-gradient-to-br from-green-600 to-green-800 rounded-xl p-6">
                <div className="text-sm text-green-200 mb-1">{t('achievements:summary.unlocked')}</div>
                <div className="text-3xl font-bold">
                  {summary.unlockedAchievements} / {summary.totalAchievements}
                </div>
              </div>
              <div className="bg-gradient-to-br from-purple-600 to-purple-800 rounded-xl p-6">
                <div className="text-sm text-purple-200 mb-1">{t('achievements:summary.progress')}</div>
                <div className="text-3xl font-bold">
                  {summary.totalAchievements > 0
                    ? Math.round((summary.unlockedAchievements / summary.totalAchievements) * 100)
                    : 0}%
                </div>
              </div>
              <button
                onClick={() => setShowLeaderboard(true)}
                className="bg-gradient-to-br from-yellow-600 to-yellow-800 rounded-xl p-6 hover:from-yellow-500 hover:to-yellow-700 transition-all text-left"
              >
                <div className="text-sm text-yellow-200 mb-1">{t('achievements:summary.leaderboard')}</div>
                <div className="text-3xl font-bold">{t('achievements:summary.view')}</div>
              </button>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-4 mb-6">
            <button
              onClick={handleCheckAchievements}
              className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 rounded-lg font-semibold transition-all"
            >
              {t('achievements:checkNew')}
            </button>
          </div>

          {/* Filters */}
          <div className="bg-gray-800 rounded-xl p-6 mb-6">
            <div className="flex flex-wrap gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">{t('achievements:filters.category')}</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">{t('achievements:filters.allCategories')}</option>
                  {Object.entries(categoryNames).map(([key, name]) => (
                    <option key={key} value={key}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">{t('achievements:filters.tier')}</label>
                <select
                  value={selectedTier}
                  onChange={(e) => setSelectedTier(e.target.value)}
                  className="px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">{t('achievements:filters.allTiers')}</option>
                  <option value="bronze">{t('achievements:tiers.bronze')}</option>
                  <option value="silver">{t('achievements:tiers.silver')}</option>
                  <option value="gold">{t('achievements:tiers.gold')}</option>
                  <option value="platinum">{t('achievements:tiers.platinum')}</option>
                  <option value="diamond">{t('achievements:tiers.diamond')}</option>
                </select>
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showUnlockedOnly}
                    onChange={(e) => setShowUnlockedOnly(e.target.checked)}
                    className="w-5 h-5 rounded bg-gray-700 border-gray-600 text-blue-600 focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm">{t('achievements:filters.showUnlockedOnly')}</span>
                </label>
              </div>
            </div>
          </div>

          {/* Achievements Grid */}
          <div className="space-y-8">
            {Object.entries(groupedAchievements).map(([category, categoryAchievements]) => (
              <div key={category}>
                <h2 className="text-2xl font-bold mb-4">{categoryNames[category] || category}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categoryAchievements.map((achievement) => (
                    <div
                      key={achievement.id}
                      className={`relative rounded-xl overflow-hidden transition-all ${achievement.isUnlocked
                          ? 'bg-gradient-to-br ' + tierColors[achievement.tier]
                          : 'bg-gray-800 opacity-60'
                        } ${achievement.isUnlocked ? 'hover:scale-105' : ''}`}
                    >
                      <div className="p-6">
                        <div className="flex items-start justify-between mb-3">
                          <div className="text-4xl">{achievement.icon}</div>
                          <div
                            className={`text-xs font-bold uppercase px-2 py-1 rounded ${achievement.isUnlocked
                                ? tierTextColors[achievement.tier]
                                : 'text-gray-500'
                              }`}
                          >
                            {t(`achievements:tiers.${achievement.tier}`)}
                          </div>
                        </div>

                        <h3 className="text-xl font-bold mb-2">{achievement.name}</h3>
                        <p className="text-sm text-gray-300 mb-4">{achievement.description}</p>

                        {!achievement.isUnlocked && (
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span>{t('achievements:progress.label')}</span>
                              <span className="font-semibold">
                                {achievement.progress} / {achievement.requirement}
                              </span>
                            </div>
                            <div className="w-full bg-gray-700 rounded-full h-2">
                              <div
                                className="bg-blue-500 h-2 rounded-full transition-all"
                                style={{ width: `${achievement.progressPercentage}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {achievement.isUnlocked && (
                          <div className="flex items-center justify-between mt-4">
                            <span className="text-sm text-gray-200">
                              {t('achievements:progress.unlocked', {
                                date: achievement.unlockedAt && new Date(achievement.unlockedAt).toLocaleDateString(),
                              })}
                            </span>
                            <span className="text-lg font-bold text-yellow-400">
                              +{achievement.points}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {filteredAchievements.length === 0 && (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">🏆</div>
              <h3 className="text-2xl font-bold mb-2">{t('achievements:empty.title')}</h3>
              <p className="text-gray-400">{t('achievements:empty.message')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
