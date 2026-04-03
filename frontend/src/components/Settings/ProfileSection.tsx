import React from "react";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";

interface ProfileSectionProps {
  profile: {
    username: string;
    email: string;
    profilePicture?: string;
  };
  privacy: {
    accountDeletionRequested?: boolean;
  };
  savingProfile: boolean;
  uploadingProfilePicture: boolean;
  onSaveProfile: () => void;
  onAvatarUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSetProfile: (partial: { username?: string; email?: string }) => void;
  onSetPrivacy: (partial: { accountDeletionRequested?: boolean }) => void;
  onShowPasswordModal: () => void;
}

export default function ProfileSection({
  profile,
  privacy,
  savingProfile,
  uploadingProfilePicture,
  onSaveProfile,
  onAvatarUpload,
  onSetProfile,
  onSetPrivacy,
  onShowPasswordModal,
}: ProfileSectionProps): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);

  return (
    <SectionCard>
      <div className="flex items-center justify-between">
        <SectionTitle
          title={t("settings:profile.title")}
          description={t("settings:profile.description")}
        />
        <button onClick={onShowPasswordModal} className="btn-secondary">
          {t("settings:profile.changePassword")}
        </button>
      </div>

      <div className="flex items-center gap-4">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white"
          style={{ background: "linear-gradient(135deg, var(--accent), #c27a1a)" }}
        >
          {profile.profilePicture ? (
            <img
              src={profile.profilePicture}
              alt={t("settings:profile.title")}
              className="w-full h-full object-cover rounded-full"
            />
          ) : (
            profile.username.charAt(0).toUpperCase()
          )}
        </div>
        <div>
          <label className="label">{t("settings:profile.uploadAvatar")}</label>
          <input
            type="file"
            accept="image/*"
            onChange={onAvatarUpload}
            disabled={uploadingProfilePicture}
            className="text-sm"
            style={{ color: "var(--text-muted)" }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">{t("settings:profile.username")}</label>
          <input
            type="text"
            value={profile.username}
            onChange={(e) => onSetProfile({ username: e.target.value })}
            className="input"
          />
        </div>
        <div>
          <label className="label">{t("settings:profile.email")}</label>
          <input
            type="email"
            value={profile.email}
            onChange={(e) => onSetProfile({ email: e.target.value })}
            className="input"
          />
        </div>
      </div>

      <div className="flex justify-end pt-4" style={{ borderTop: "1px solid var(--color-border)" }}>
        <button
          onClick={onSaveProfile}
          disabled={savingProfile}
          className="btn-primary"
          style={{ boxShadow: "0 0 16px rgba(232,160,69,0.25)" }}
        >
          {savingProfile
            ? t("common:buttons.saving") || "Speichern..."
            : t("settings:profile.save") || "Profil speichern"}
        </button>
      </div>

      {/* Danger Zone */}
      <div
        className="mt-6 pt-4"
        style={{ borderTop: "1px solid rgba(var(--danger-rgb, 220,38,38), 0.3)" }}
      >
        <p
          className="text-xs font-semibold uppercase tracking-widest mb-3"
          style={{ color: "var(--danger)" }}
        >
          {t("settings:profile.dangerZone")}
        </p>
        <div
          className="rounded-lg p-4"
          style={{
            border: "1px solid rgba(var(--danger-rgb, 220,38,38), 0.4)",
            background: "rgba(var(--danger-rgb, 220,38,38), 0.05)",
          }}
        >
          <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
            {t("settings:profile.dangerZoneDescription")}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="btn-danger"
              onClick={() => onSetPrivacy({ accountDeletionRequested: true })}
            >
              {t("settings:profile.deleteAccount")}
            </button>
            {privacy.accountDeletionRequested && (
              <span className="text-sm" style={{ color: "var(--danger)" }}>
                {t("settings:profile.deletionRequested")}
              </span>
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
