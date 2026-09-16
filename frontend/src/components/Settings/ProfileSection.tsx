import React from "react";
import { SectionCard, SectionTitle } from "./SettingsShared";
import HelpIcon from "../Help/HelpIcon";
import { Icon } from "../ui/Icon";
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
}: ProfileSectionProps): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:profile.title")}
        description={t("settings:profile.description")}
      />
      {/* The head of the card: who this is. Round 4 draws a square tile with
          the initial (or the picture), the name, one meta line and the one
          action on the picture; "change password" moved to Sicherheit. */}
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-lg)" }}>
        <div
          className="flex items-center justify-center overflow-hidden shrink-0"
          style={{
            width: 64,
            height: 64,
            borderRadius: "var(--ts-radius-card)",
            background: "var(--ts-tile)",
            border: "1px solid var(--ts-border)",
            color: "var(--ts-accent)",
            fontSize: 24,
            fontWeight: 700,
          }}
        >
          {profile.profilePicture ? (
            <img
              src={profile.profilePicture}
              alt={t("settings:profile.title")}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            (profile.firstName || profile.username).charAt(0).toUpperCase()
          )}
        </div>
        <div className="flex min-w-0 flex-col" style={{ gap: 2, flex: "1 1 200px" }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}>
            {fullName || profile.username}
          </span>
          <span className="t-caption inline-flex items-center gap-1.5">
            @{profile.username}
            {profile.email ? ` · ${profile.email}` : ""}
            <HelpIcon content={t("settings:profile.help.avatar")} position="top" />
          </span>
        </div>
        <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
          {/* Native <input type=file> shows the browser-locale "Choose File"
              label which conflicts with the app i18n. Hide it visually and
              drive it from a labelled button so the copy stays under our
              translation control. */}
          <label
            className="btn-secondary inline-flex items-center gap-2 cursor-pointer"
            style={{
              opacity: uploadingProfilePicture ? 0.6 : 1,
              pointerEvents: uploadingProfilePicture ? "none" : "auto",
            }}
          >
            <Icon name="upload" size={14} />
            {uploadingProfilePicture
              ? t("common:buttons.uploading", { defaultValue: "Uploading..." })
              : t("settings:profile.changePicture")}
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
              className="btn-secondary inline-flex items-center gap-2"
              style={{ color: "var(--ts-bad)", opacity: removingProfilePicture ? 0.6 : 1 }}
            >
              <Icon name="trash-2" size={14} />
              {removingProfilePicture
                ? t("common:buttons.removing", { defaultValue: "Removing..." })
                : t("settings:profile.removeAvatar", { defaultValue: "Remove picture" })}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          {/*
           * The username is shown, not edited. It used to be a plain input whose
           * contents "Save profile" dutifully sent — the server stored it in the
           * settings blob, answered 200, and the next load replaced it with the
           * real name from /auth/me again, because the account name is a column
           * on User and nothing here ever touched it. A rename that survives
           * would need a uniqueness check and a decision about existing sessions;
           * until that exists, showing the name is honest and an editable field
           * is not (audit finding AUD-025).
           */}
          <label className="label" htmlFor="profile-username">
            {t("settings:profile.username")}
          </label>
          <input
            id="profile-username"
            type="text"
            value={profile.username}
            readOnly
            aria-describedby="profile-username-hint"
            className="input opacity-70 cursor-not-allowed"
          />
          <p
            id="profile-username-hint"
            className="text-xs mt-1"
            style={{ color: "var(--text-muted)" }}
          >
            {t("settings:profile.usernameHint")}
          </p>
        </div>
        <div>
          <label className="label" htmlFor="profile-first-name">
            {t("settings:profile.firstName")}
          </label>
          <input
            id="profile-first-name"
            type="text"
            value={profile.firstName ?? ""}
            onChange={(e) => onSetProfile({ firstName: e.target.value })}
            className="input"
            autoComplete="given-name"
          />
        </div>
        <div>
          <label className="label" htmlFor="profile-last-name">
            {t("settings:profile.lastName")}
          </label>
          <input
            id="profile-last-name"
            type="text"
            value={profile.lastName ?? ""}
            onChange={(e) => onSetProfile({ lastName: e.target.value })}
            className="input"
            autoComplete="family-name"
          />
        </div>
        <div>
          <label className="label" htmlFor="profile-email">
            {t("settings:profile.email")}
          </label>
          <input
            id="profile-email"
            type="email"
            value={profile.email}
            onChange={(e) => onSetProfile({ email: e.target.value })}
            className="input"
            autoComplete="email"
          />
        </div>
        <div>
          <label className="label" htmlFor="profile-birthdate">
            {t("settings:profile.birthdate")}
          </label>
          <input
            id="profile-birthdate"
            type="date"
            value={profile.birthdate ?? ""}
            onChange={(e) => onSetProfile({ birthdate: e.target.value || null })}
            className="input"
            aria-describedby="profile-birthdate-hint"
          />
          <p
            id="profile-birthdate-hint"
            className="text-xs mt-1"
            style={{ color: "var(--text-muted)" }}
          >
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
