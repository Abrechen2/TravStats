/**
 * The readiness catalogue (setup & readiness, spec 2026-11-14 §3, §11): every
 * check and every update note as plain data — ids, revisions, severities, copy
 * keys and settings addresses, and nothing that runs.
 *
 * It sits in `shared/` and imports nothing so the frontend can read the very
 * same list: its test asserts that every `titleKey` / `consequenceKey` /
 * `beforeKey` / `afterKey` exists in DE and EN under the `readiness` namespace
 * and that every `action` / address resolves through `resolveAddress`
 * (`pages/Settings/area/redirects.ts`). Mirror it byte-identically to
 * `frontend/src/shared/readinessCatalogue.ts` (pattern: `comparisonMetrics.ts`).
 *
 * The evaluators and `appliesWhen` predicates live in
 * `services/readiness/registry.ts`, keyed by these ids in an exhaustive record,
 * so a catalogue entry without one is a type error.
 *
 * Raise a check's `revision` when its meaning changes: every snooze and
 * "nutze ich nicht" given to the old meaning stops counting.
 */

export type ReadinessScope = "admin" | "user";
export type ReadinessSeverity = "required" | "recommended";

export const CHECK_IDS = [
  "admin.smtp",
  "admin.publicUrl",
  "admin.backup",
  "admin.disk",
  "admin.offsite",
  "admin.providerKeys",
  "admin.bookingMailbox",
  "user.domains",
  "user.home",
  "user.phonePaired",
  "user.firstPosition",
  "user.apiKeys",
  "user.mailForwarding",
  "user.notificationEmail",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export interface CheckCatalogueEntry {
  readonly id: CheckId;
  readonly revision: number;
  readonly scope: ReadinessScope;
  /** `required` raises the admin banner on a verified failure (owner, 2026-11-14). */
  readonly severity: ReadinessSeverity;
  /** i18n keys, namespace `readiness`. */
  readonly titleKey: string;
  readonly consequenceKey: string;
  /** A settings address `resolveAddress` accepts. */
  readonly action: string;
  /** A stored result older than this reads as `unknown`; null = the result does not age. */
  readonly maxAgeDays: number | null;
  /** The admin item this one waits for while that item needs action. */
  readonly blockedBy: CheckId | null;
}

const c = (e: CheckCatalogueEntry): CheckCatalogueEntry => e;

export const CHECK_CATALOGUE: readonly CheckCatalogueEntry[] = [
  c({
    id: "admin.smtp",
    revision: 1,
    scope: "admin",
    severity: "recommended",
    titleKey: "checks.adminSmtp.title",
    consequenceKey: "checks.adminSmtp.consequence",
    action: "/settings/email",
    maxAgeDays: 180,
    blockedBy: null,
  }),
  c({
    id: "admin.publicUrl",
    revision: 1,
    scope: "admin",
    severity: "required",
    titleKey: "checks.adminPublicUrl.title",
    consequenceKey: "checks.adminPublicUrl.consequence",
    action: "/settings/adressen",
    maxAgeDays: 60,
    blockedBy: null,
  }),
  c({
    id: "admin.backup",
    revision: 1,
    scope: "admin",
    severity: "required",
    titleKey: "checks.adminBackup.title",
    consequenceKey: "checks.adminBackup.consequence",
    action: "/settings/sicherungen",
    maxAgeDays: null,
    blockedBy: null,
  }),
  c({
    id: "admin.disk",
    revision: 1,
    scope: "admin",
    severity: "required",
    titleKey: "checks.adminDisk.title",
    consequenceKey: "checks.adminDisk.consequence",
    action: "/settings/sicherungen",
    maxAgeDays: null,
    blockedBy: null,
  }),
  c({
    id: "admin.offsite",
    revision: 1,
    scope: "admin",
    severity: "recommended",
    titleKey: "checks.adminOffsite.title",
    consequenceKey: "checks.adminOffsite.consequence",
    action: "/settings/dienste?service=webdav",
    maxAgeDays: null,
    blockedBy: null,
  }),
  c({
    id: "admin.providerKeys",
    revision: 1,
    scope: "admin",
    severity: "recommended",
    titleKey: "checks.adminProviderKeys.title",
    consequenceKey: "checks.adminProviderKeys.consequence",
    action: "/settings/dienste",
    maxAgeDays: 90,
    blockedBy: null,
  }),
  c({
    id: "admin.bookingMailbox",
    revision: 1,
    scope: "admin",
    severity: "recommended",
    titleKey: "checks.adminBookingMailbox.title",
    consequenceKey: "checks.adminBookingMailbox.consequence",
    action: "/settings/dienste?service=mailIntake",
    maxAgeDays: 3,
    blockedBy: null,
  }),
  c({
    id: "user.domains",
    revision: 1,
    scope: "user",
    severity: "recommended",
    titleKey: "checks.userDomains.title",
    consequenceKey: "checks.userDomains.consequence",
    action: "/settings/reisearten",
    maxAgeDays: null,
    blockedBy: null,
  }),
  c({
    id: "user.home",
    revision: 1,
    scope: "user",
    severity: "recommended",
    titleKey: "checks.userHome.title",
    consequenceKey: "checks.userHome.consequence",
    action: "/settings/reisearten#home",
    maxAgeDays: null,
    blockedBy: null,
  }),
  c({
    id: "user.phonePaired",
    revision: 1,
    scope: "user",
    severity: "recommended",
    titleKey: "checks.userPhonePaired.title",
    consequenceKey: "checks.userPhonePaired.consequence",
    action: "/settings/telefone",
    maxAgeDays: null,
    blockedBy: null,
  }),
  c({
    id: "user.firstPosition",
    revision: 1,
    scope: "user",
    severity: "recommended",
    titleKey: "checks.userFirstPosition.title",
    consequenceKey: "checks.userFirstPosition.consequence",
    action: "/settings/tt-aufz",
    maxAgeDays: null,
    blockedBy: null,
  }),
  c({
    id: "user.apiKeys",
    revision: 1,
    scope: "user",
    severity: "recommended",
    titleKey: "checks.userApiKeys.title",
    consequenceKey: "checks.userApiKeys.consequence",
    action: "/settings/dienstek",
    maxAgeDays: 90,
    blockedBy: null,
  }),
  c({
    id: "user.mailForwarding",
    revision: 1,
    scope: "user",
    severity: "recommended",
    titleKey: "checks.userMailForwarding.title",
    consequenceKey: "checks.userMailForwarding.consequence",
    action: "/settings/dienstek?service=mailIntake",
    maxAgeDays: null,
    blockedBy: "admin.bookingMailbox",
  }),
  c({
    id: "user.notificationEmail",
    revision: 1,
    scope: "user",
    severity: "recommended",
    titleKey: "checks.userNotificationEmail.title",
    consequenceKey: "checks.userNotificationEmail.consequence",
    action: "/settings/erinnerungen",
    maxAgeDays: null,
    blockedBy: "admin.smtp",
  }),
];

export const NOTE_IDS = [
  "2.8.0.settingsRemoved",
  "2.8.0.backupsAlwaysOn",
  "2.8.0.retentionScheduledOnly",
  "2.8.0.friendsMerged",
  "2.8.0.externalServicesMoved",
  "2.8.0.ownServersPublic",
] as const;
export type NoteId = (typeof NOTE_IDS)[number];

export type NoteAction =
  | { readonly kind: "check"; readonly checkId: CheckId }
  | { readonly kind: "address"; readonly address: string };

export interface NoteCatalogueEntry {
  readonly id: NoteId;
  /** The release that introduced the change (a final version, `X.Y.Z`). */
  readonly version: string;
  readonly audience: ReadinessScope;
  /** i18n keys, namespace `readiness`. */
  readonly beforeKey: string;
  readonly afterKey: string;
  /** Exactly one of `action` and `noActionReason` is set. */
  readonly action: NoteAction | null;
  readonly noActionReason: string | null;
}

const n = (e: NoteCatalogueEntry): NoteCatalogueEntry => e;

export const NOTE_CATALOGUE: readonly NoteCatalogueEntry[] = [
  n({
    id: "2.8.0.settingsRemoved",
    version: "2.8.0",
    audience: "admin",
    beforeKey: "notes.v280SettingsRemoved.before",
    afterKey: "notes.v280SettingsRemoved.after",
    action: null,
    noActionReason:
      "The removed switches have no replacement choice; the behaviour they gated is now fixed.",
  }),
  n({
    id: "2.8.0.backupsAlwaysOn",
    version: "2.8.0",
    audience: "admin",
    beforeKey: "notes.v280BackupsAlwaysOn.before",
    afterKey: "notes.v280BackupsAlwaysOn.after",
    action: { kind: "check", checkId: "admin.backup" },
    noActionReason: null,
  }),
  n({
    id: "2.8.0.retentionScheduledOnly",
    version: "2.8.0",
    audience: "admin",
    beforeKey: "notes.v280RetentionScheduledOnly.before",
    afterKey: "notes.v280RetentionScheduledOnly.after",
    action: { kind: "address", address: "/settings/sicherungen" },
    noActionReason: null,
  }),
  n({
    id: "2.8.0.friendsMerged",
    version: "2.8.0",
    audience: "user",
    beforeKey: "notes.v280FriendsMerged.before",
    afterKey: "notes.v280FriendsMerged.after",
    action: null,
    noActionReason: "Merged automatically on upgrade; nothing shared so far is lost.",
  }),
  n({
    id: "2.8.0.externalServicesMoved",
    version: "2.8.0",
    audience: "admin",
    beforeKey: "notes.v280ExternalServicesMoved.before",
    afterKey: "notes.v280ExternalServicesMoved.after",
    action: { kind: "address", address: "/settings/dienste" },
    noActionReason: null,
  }),
  n({
    id: "2.8.0.ownServersPublic",
    version: "2.8.0",
    audience: "user",
    beforeKey: "notes.v280OwnServersPublic.before",
    afterKey: "notes.v280OwnServersPublic.after",
    action: { kind: "address", address: "/settings/dienstek" },
    noActionReason: null,
  }),
];
