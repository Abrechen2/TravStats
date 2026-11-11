import React from "react";
import { SectionCard } from "./SettingsShared";
import HelpIcon from "../Help/HelpIcon";
import { Icon } from "../ui/Icon";
import { SettingRows } from "../ui/SettingRow";
import {
  ActionControl,
  SettingWriteError,
  GroupStateMark,
  InputControl,
  SettingItem,
  StatusValue,
  useGroupSave,
} from "../ui/settings";
import { useSettingItem } from "../ui/settings/itemContext";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { canonicalPrivateFileUrl } from "../../lib/privateFileUrl";
import {
  birthdateWasSaved,
  generalSettingsWereSaved,
  useSettingsStore,
} from "../../store/settingsStore";
import { useRemoteSettingsStatus } from "../../store/remoteSettingsStatus";
import PassportRow from "./PassportRow";
import { useExpertRows } from "./frame/useExpertRows";

interface ProfileSectionProps {
  profile: {
    username: string;
    email: string;
    profilePicture?: string;
    birthdate?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  };
  uploadingProfilePicture: boolean;
  removingProfilePicture: boolean;
  onAvatarUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAvatarDelete: () => void;
}

interface ProfileDraft extends Record<string, unknown> {
  firstName: string;
  lastName: string;
  email: string;
  birthdate: string;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function DateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}): JSX.Element {
  const { id, locked, describedBy, changed } = useSettingItem();
  return (
    <input
      id={id}
      type="date"
      className="input"
      value={value}
      disabled={locked}
      aria-disabled={locked || undefined}
      aria-describedby={describedBy}
      style={changed ? { border: "1px solid var(--ts-accent)" } : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * Profil: the picture, then one group with a save button — names, e-mail and
 * birthday travel together ("Profil speichern"), and a failed save keeps the
 * draft instead of snapping back. The settings document is written only when
 * the user saves; until then the draft lives apart from the store.
 */
export default function ProfileSection({
  profile,
  uploadingProfilePicture,
  removingProfilePicture,
  onAvatarUpload,
  onAvatarDelete,
}: ProfileSectionProps): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const isDemo = useIsDemoAccount();
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  const locked = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;

  const saved: ProfileDraft = {
    firstName: profile.firstName ?? "",
    lastName: profile.lastName ?? "",
    email: profile.email,
    birthdate: profile.birthdate ?? "",
  };
  const group = useGroupSave<ProfileDraft>({
    id: "account.profile",
    label: t("settings:profile.group.label"),
    saved,
    write: async (draft) => {
      // Settings that never loaded must not be written over the account's own
      // (forgejo#372): the document would carry defaults.
      if (useRemoteSettingsStatus.getState().failed) throw new SettingWriteError("notLoaded");
      const store = useSettingsStore.getState();
      const previous = { ...store.profile };
      store.setProfile({
        firstName: draft.firstName.trim() || null,
        lastName: draft.lastName.trim() || null,
        email: draft.email.trim(),
        birthdate: draft.birthdate || null,
      });
      try {
        await useSettingsStore.getState().saveRemoteSettings();
      } catch (error) {
        // Only the birthdate write was refused: the rest is saved, take back
        // the birthdate alone. Otherwise the whole document was refused.
        const partial = generalSettingsWereSaved(error);
        const keepBirthdate = birthdateWasSaved(error);
        useSettingsStore.getState().setProfile(
          partial
            ? { birthdate: previous.birthdate }
            : {
                firstName: previous.firstName,
                lastName: previous.lastName,
                email: previous.email,
                birthdate: keepBirthdate ? draft.birthdate || null : previous.birthdate,
              }
        );
        throw error;
      }
    },
  });
  const showBirthdate = useExpertRows(1);
  const emailBad = group.draft.email.trim() !== "" && !EMAIL_SHAPE.test(group.draft.email.trim());

  return (
    <SectionCard>
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
              src={canonicalPrivateFileUrl(profile.profilePicture)}
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
            <HelpIcon
              content={t("settings:profile.help.avatar")}
              position="top"
              subject={t("settings:profile.changePicture")}
            />
          </span>
        </div>
        {isDemo ? null : (
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
        )}
      </div>

      <SettingRows>
        <SettingItem
          title={t("settings:profile.firstName")}
          locked={locked}
          changed={group.isChanged("firstName")}
          control={
            <InputControl
              value={group.draft.firstName}
              onChange={(firstName) => group.edit({ firstName })}
            />
          }
        />
        <SettingItem
          title={t("settings:profile.lastName")}
          locked={locked}
          changed={group.isChanged("lastName")}
          control={
            <InputControl
              value={group.draft.lastName}
              onChange={(lastName) => group.edit({ lastName })}
            />
          }
        />
        <SettingItem
          title={t("settings:profile.display.name")}
          sub={t("settings:profile.display.sub")}
          control={
            <StatusValue>
              {[group.draft.firstName, group.draft.lastName]
                .map((part) => part.trim())
                .filter(Boolean)
                .join(" ") || profile.username}
            </StatusValue>
          }
        />
        <SettingItem
          title={t("settings:profile.username")}
          sub={t("settings:profile.usernameSub")}
          control={<StatusValue>@{profile.username}</StatusValue>}
        />
        <SettingItem
          title={t("settings:profile.email")}
          sub={t("settings:profile.emailSub")}
          help={t("settings:profile.emailHelp")}
          locked={locked}
          changed={group.isChanged("email")}
          error={emailBad ? t("settings:profile.emailBad") : undefined}
          control={
            <InputControl
              type="email"
              inputMode="email"
              value={group.draft.email}
              onChange={(email) => group.edit({ email })}
            />
          }
        />
        <PassportRow />
        {showBirthdate && (
          <SettingItem
            title={t("settings:profile.birthdate")}
            sub={t("settings:profile.birthdateSub")}
            help={t("settings:profile.birthdateHelp")}
            locked={locked}
            changed={group.isChanged("birthdate")}
            control={
              <DateField
                value={group.draft.birthdate}
                onChange={(birthdate) => group.edit({ birthdate })}
              />
            }
          />
        )}
      </SettingRows>
      {!isDemo && (
        <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
          <ActionControl
            label={t("settings:profile.save")}
            busy={group.state === "saving"}
            onClick={() => {
              if (emailBad || group.state === "unchanged") return;
              void group.save();
            }}
          />
          {group.state !== "unchanged" && (
            <ActionControl label={t("settings:blocks.save.discardGroup")} onClick={group.discard} />
          )}
          <GroupStateMark state={group.state} reason={group.reason} />
        </div>
      )}
    </SectionCard>
  );
}
