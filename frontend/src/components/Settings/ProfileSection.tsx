import React from "react";
import { FieldLabel, SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";

interface ProfileSectionProps {
  profile: {
    username: string;
    email: string;
    profilePicture?: string;
    birthdate?: string | null;
    // Real name (#241) — optional, and shown next to the username because one
    // identifies you to the instance while the other is how you are addressed.
    firstName?: string | null;
    lastName?: string | null;
  };
  savingProfile: boolean;
  uploadingProfilePicture: boolean;
  removingProfilePicture: boolean;
  onSaveProfile: () => void;
  onAvatarUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAvatarDelete: () => void;
  onSetProfile: (partial: {
    username?: string;
    email?: string;
    birthdate?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }) => void;
  onShowPasswordModal: () => void;
}

export default function ProfileSection({
  profile,
  savingProfile,
  uploadingProfilePicture,
  removingProfilePicture,
  onSaveProfile,
  onAvatarUpload,
  onAvatarDelete,
  onSetProfile,
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
          <FieldLabel help={t("settings:profile.help.avatar")}>{t("settings:profile.uploadAvatar")}</FieldLabel>
          {/* Native <input type=file> shows the browser-locale "Choose File"
              label which conflicts with the app i18n. Hide it visually and
              drive it from a labelled button so the copy stays under our
              translation control. */}
          <label
            className="btn-secondary inline-flex items-center gap-2 cursor-pointer text-sm"
            style={{
              opacity: uploadingProfilePicture ? 0.6 : 1,
              pointerEvents: uploadingProfilePicture ? "none" : "auto",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {uploadingProfilePicture
              ? t("common:buttons.uploading", { defaultValue: "Uploading..." })
              : t("settings:profile.chooseFile", { defaultValue: "Choose file" })}
            <input
              type="file"
              accept="image/*"
              onChange={onAvatarUpload}
              disabled={uploadingProfilePicture}
              className="sr-only"
            />
          </label>
          {profile.profilePicture && (
            <button
              type="button"
              onClick={onAvatarDelete}
              disabled={removingProfilePicture || uploadingProfilePicture}
              className="btn-secondary inline-flex items-center gap-2 text-sm ml-2"
              style={{
                color: "var(--color-danger, #ef4444)",
                opacity: removingProfilePicture ? 0.6 : 1,
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              {removingProfilePicture
                ? t("common:buttons.removing", { defaultValue: "Removing..." })
                : t("settings:profile.removeAvatar", { defaultValue: "Remove picture" })}
            </button>
          )}
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
          <label className="label">{t("settings:profile.firstName")}</label>
          <input
            type="text"
            value={profile.firstName ?? ""}
            onChange={(e) => onSetProfile({ firstName: e.target.value })}
            className="input"
            autoComplete="given-name"
          />
        </div>
        <div>
          <label className="label">{t("settings:profile.lastName")}</label>
          <input
            type="text"
            value={profile.lastName ?? ""}
            onChange={(e) => onSetProfile({ lastName: e.target.value })}
            className="input"
            autoComplete="family-name"
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
        <div>
          <label className="label">{t("settings:profile.birthdate")}</label>
          <input
            type="date"
            value={profile.birthdate ?? ""}
            onChange={(e) => onSetProfile({ birthdate: e.target.value || null })}
            className="input"
          />
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {t("settings:profile.birthdateHint")}
          </p>
        </div>
      </div>

      <div className="flex justify-end pt-4" style={{ borderTop: "1px solid var(--color-border)" }}>
        <button
          onClick={onSaveProfile}
          disabled={savingProfile}
          className="btn-primary"
          style={{ boxShadow: "0 0 16px rgba(240,169,71,0.25)" }}
        >
          {savingProfile
            ? t("common:buttons.saving") || "Speichern..."
            : t("settings:profile.save") || "Profil speichern"}
        </button>
      </div>
    </SectionCard>
  );
}
