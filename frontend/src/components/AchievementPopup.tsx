/**
 * Achievement Popup Component
 *
 * Displays a celebration popup when user unlocks new achievements
 */

import { useEffect, useState, useRef } from "react";
import { useTranslation } from "../hooks/useTranslation";

interface Achievement {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  tier: "bronze" | "silver" | "gold" | "platinum" | "diamond";
  category: string;
  points: number;
}

interface UserAchievement {
  id: string;
  achievementId: string;
  progress: number;
  unlockedAt: string;
  achievement: Achievement;
}

interface AchievementPopupProps {
  achievements: UserAchievement[];
  onClose: () => void;
}

// Tier gradients stay metal/material-themed (bronze, silver, gold, platinum,
// diamond). Platinum + diamond previously leaked POI-cyan / cruise-blue and
// Hotel-purple / pink — per BRAND.md §3 domain hexes never leave their
// domain. Replaced with cool neutral tones so the metal-tier semantic still
// reads without claiming domain colour.
const tierColors = {
  bronze: "from-orange-700 to-orange-500",
  silver: "from-gray-400 to-gray-300",
  gold: "from-yellow-500 to-yellow-400",
  platinum: "from-slate-400 to-slate-200",
  diamond: "from-slate-200 to-white",
};

const tierGlow = {
  bronze: "shadow-orange-500/50",
  silver: "shadow-gray-400/50",
  gold: "shadow-yellow-500/50",
  platinum: "shadow-slate-300/50",
  diamond: "shadow-white/40",
};

export default function AchievementPopup({
  achievements,
  onClose,
}: AchievementPopupProps): JSX.Element | null {
  const { t } = useTranslation(["achievements", "common"]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isExiting, setIsExiting] = useState(false);
  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  const currentAchievement = achievements[currentIndex];

  useEffect(() => {
    // Auto-close after 8 seconds
    const timer = setTimeout(() => {
      handleNext();
    }, 8000);
    timeoutRefs.current.push(timer);

    return () => {
      clearTimeout(timer);
      // Clear all timeouts on unmount
      timeoutRefs.current.forEach((t) => clearTimeout(t));
      timeoutRefs.current = [];
    };
  }, [currentIndex]);

  const handleNext = () => {
    if (currentIndex < achievements.length - 1) {
      setIsExiting(true);
      const timer = setTimeout(() => {
        setIsExiting(false);
        setCurrentIndex(currentIndex + 1);
      }, 300);
      timeoutRefs.current.push(timer);
    } else {
      setIsExiting(true);
      const timer = setTimeout(onClose, 300);
      timeoutRefs.current.push(timer);
    }
  };

  const handleClose = () => {
    setIsExiting(true);
    const timer = setTimeout(() => {
      // Clear all timeouts before closing
      timeoutRefs.current.forEach((t) => clearTimeout(t));
      timeoutRefs.current = [];
      onClose();
    }, 300);
    timeoutRefs.current.push(timer);
  };

  if (!currentAchievement) return null;

  const tier = currentAchievement.achievement.tier;

  return (
    <div
      className={`fixed inset-0 bg-black/70 flex items-center justify-center z-200 p-4 ${isExiting ? "animate-fadeOut" : "animate-fadeIn"}`}
    >
      <div
        className={`
        bg-(--bg-surface)
        rounded-2xl max-w-md w-full p-8 shadow-2xl
        ${tierGlow[tier]}
        ${isExiting ? "scale-95 opacity-0" : "scale-100 opacity-100"}
        transition-all duration-300
      `}
      >
        {/* Confetti Animation */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
          <div className="confetti-container">
            {[...Array(20)].map((_, i) => (
              <div
                key={i}
                className="confetti"
                style={{
                  left: `${Math.random() * 100}%`,
                  animationDelay: `${Math.random() * 2}s`,
                  animationDuration: `${3 + Math.random() * 2}s`,
                  backgroundColor: ["#FFD700", "#FFA500", "#FF69B4", "#00CED1", "#9370DB"][
                    Math.floor(Math.random() * 5)
                  ],
                }}
              />
            ))}
          </div>
        </div>

        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 rounded-lg transition-colors"
          style={{ color: "var(--text-muted)" }}
          aria-label={t("common:buttons.close")}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {/* Achievement Icon */}
        <div
          className={`
          w-32 h-32 mx-auto mb-6
          bg-linear-to-br ${tierColors[tier]}
          rounded-full
          flex items-center justify-center
          shadow-xl ${tierGlow[tier]}
          animate-bounce-slow
        `}
        >
          <span className="text-6xl">{currentAchievement.achievement.icon}</span>
        </div>

        {/* Achievement Info */}
        <div className="text-center space-y-4">
          <div>
            <div
              className="text-sm font-semibold uppercase tracking-wider mb-2"
              style={{ color: "var(--text-muted)" }}
            >
              🏆 {t("achievements:popup.unlocked")}
            </div>
            <h2 className="text-3xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
              {currentAchievement.achievement.name}
            </h2>
            <p className="text-lg" style={{ color: "var(--text-muted)" }}>
              {currentAchievement.achievement.description}
            </p>
          </div>

          {/* Tier Badge */}
          <div className="flex items-center justify-center gap-2">
            <span
              className={`
              px-4 py-2 rounded-full text-sm font-bold uppercase
              bg-linear-to-r ${tierColors[tier]}
              text-white shadow-lg
            `}
            >
              {t(`achievements:tiers.${tier}`)} {t("achievements:popup.tier")}
            </span>
            <span
              className={`
              px-3 py-1 rounded-full text-xs font-semibold
              bg-blue-900 text-blue-200
            `}
            >
              +{currentAchievement.achievement.points} {t("achievements:popup.points")}
            </span>
          </div>

          {/* Progress Indicator */}
          {achievements.length > 1 && (
            <div className="pt-4">
              <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
                {t("achievements:popup.progress", {
                  current: currentIndex + 1,
                  total: achievements.length,
                })}
              </div>
              <div className="flex gap-1 justify-center">
                {achievements.map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-1.5 rounded-full transition-all ${
                      idx === currentIndex
                        ? "w-8 bg-linear-to-r " + tierColors[tier]
                        : idx < currentIndex
                          ? "w-1.5 bg-(--text-muted)"
                          : "w-1.5 bg-border"
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            {currentIndex < achievements.length - 1 ? (
              <>
                <button
                  onClick={handleClose}
                  className="flex-1 px-4 py-2 rounded-lg font-medium bg-(--bg-elevated) hover:bg-(--bg-muted) text-(--text-primary)"
                >
                  {t("achievements:popup.closeAll")}
                </button>
                <button
                  onClick={handleNext}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium bg-linear-to-r ${tierColors[tier]} text-white shadow-lg hover:shadow-xl transition-all`}
                >
                  {t("achievements:popup.next")} →
                </button>
              </>
            ) : (
              <button
                onClick={handleClose}
                className={`w-full px-4 py-2 rounded-lg font-medium bg-linear-to-r ${tierColors[tier]} text-white shadow-lg hover:shadow-xl transition-all`}
              >
                {t("achievements:popup.awesome")} 🎉
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }

        @keyframes bounce-slow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }

        @keyframes confetti-fall {
          to {
            transform: translateY(100vh) rotate(360deg);
            opacity: 0;
          }
        }

        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }

        .animate-fadeOut {
          animation: fadeOut 0.3s ease-out;
        }

        .animate-bounce-slow {
          animation: bounce-slow 2s ease-in-out infinite;
        }

        .confetti {
          position: absolute;
          width: 10px;
          height: 10px;
          top: -20px;
          animation: confetti-fall linear forwards;
        }
      `}</style>
    </div>
  );
}
