import { useEffect, useMemo } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import PageHeader from "../components/ui/PageHeader";
import { useTranslation } from "../hooks/useTranslation";
import { useSettingsPage } from "../components/Settings/useSettingsPage";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useBetaFeatures } from "../hooks/useBetaFeatures";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import PasswordModal from "../components/Settings/PasswordModal";
import SettingsSectionSwitch from "./Settings/SettingsSectionSwitch";
import { SECTION_LABEL_KEY } from "./Settings/sectionLabels";
import {
  DEFAULT_GROUP,
  GENERAL_GROUP_IDS,
  SETTINGS_GROUPS,
  findGroup,
  groupOfSection,
  type SettingsGroup,
  type SettingsSectionId,
} from "./Settings/settingsModel";

/**
 * Groups whose sections write through the settings store's auto-save, and
 * therefore drive `autoSaveState`. Everywhere else the sections save
 * explicitly or not at all, and the strip would promise something that never
 * happens (UAT finding B8).
 */
const AUTO_SAVED_GROUPS = new Set(["display", "flight", "cruise", "lodging"]);

/** The one place that knows a section is only reachable by naming it. */
function useDeepLinkedSection(): string | null {
  const [searchParams] = useSearchParams();
  const fromQuery = searchParams.get("section");
  const fromHash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
  return fromQuery || fromHash || null;
}

export default function SettingsPage(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const { group: groupParam } = useParams<{ group: string }>();
  const navigate = useNavigate();
  const page = useSettingsPage();
  const { isFeatureVisible } = useBetaFeatures();
  const { isEnabled } = useEnabledDomains();
  const deepLinked = useDeepLinkedSection();
  const isAdmin = page.user?.isAdmin ?? false;

  const group = findGroup(groupParam);

  // A domain group whose domain is switched off is not a page any more. Send
  // the user to the default rather than rendering an empty frame — the same
  // rule every other domain-scoped surface follows.
  const groupIsReachable = group ? (group.domain ? isEnabled(group.domain) : true) : false;

  const visibleGroups = useMemo<SettingsGroup[]>(
    () => SETTINGS_GROUPS.filter((g) => (g.domain ? isEnabled(g.domain) : true)),
    [isEnabled]
  );

  /**
   * Which sections this group shows.
   *
   * A gated section stays out of the page — the beta switch is what decides
   * that, and un-gating is the owner's call, not a side effect of a layout
   * change. It comes back the moment a URL names it, because `?section=devices`
   * is the only way to mint a pairing code while the gate is closed, and that
   * escape hatch predates this refactor.
   */
  const sections = useMemo<SettingsSectionId[]>(() => {
    if (!group) return [];
    return group.sections.filter((id) => {
      const gate = group.gatedSections?.[id];
      if (gate && !isFeatureVisible(gate) && deepLinked !== id) return false;
      // Renders null for non-admins, so a nav entry would lead to an empty page.
      if (id === "lodgingPreferences" && !isAdmin) return false;
      return true;
    });
  }, [group, isFeatureVisible, deepLinked, isAdmin]);

  const groupLabel = group ? t(group.labelKey) : "";
  useDocumentTitle(
    group
      ? `TravStats – ${t("settings:title", { defaultValue: "Einstellungen" })} – ${groupLabel}`
      : null
  );

  // Scroll a named section into view once the group has rendered. The anchor
  // survives from the old `?section=` links, so a five-year-old bookmark still
  // lands on the right card instead of merely the right page.
  useEffect(() => {
    if (!deepLinked || !groupIsReachable) return;
    const el = document.getElementById(`settings-${deepLinked}`);
    // Feature-checked rather than assumed: jsdom has no layout, so the method
    // is simply absent there, and an unguarded call turns every settings test
    // into a crash about scrolling.
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [deepLinked, groupIsReachable]);

  if (!groupIsReachable) return <Navigate to={`/settings/${DEFAULT_GROUP}`} replace />;

  const isGeneral = (GENERAL_GROUP_IDS as readonly string[]).includes(group!.id);
  const generalGroups = visibleGroups.filter((g) => !g.domain);
  const domainGroups = visibleGroups.filter((g) => g.domain);

  // Tab bar: "Allgemein" stands for the four general routes as a set, so it
  // reads active on any of them and leads back to the first.
  const tabs = [
    {
      id: "general",
      label: t("settings:tabs.general", { defaultValue: "Allgemein" }),
      to: `/settings/${DEFAULT_GROUP}`,
      active: isGeneral,
    },
    ...domainGroups.map((g) => ({
      id: g.id,
      label: t(g.labelKey),
      to: `/settings/${g.id}`,
      active: group!.id === g.id,
    })),
  ];

  return (
    <AppShell width="list">
      <PageHeader
        title={t("settings:title", { defaultValue: "Einstellungen" })}
        meta={t("settings:scopeHint")}
      />

      {/* Domain tabs. Same shape as the logbook and the statistics sub-bar —
          three pages, one pattern. */}
      <div
        role="tablist"
        aria-label={t("settings:title", { defaultValue: "Einstellungen" })}
        className="flex overflow-x-auto scrollbar-none"
        style={{
          gap: "var(--ts-space-xs)",
          borderBottom: "1px solid var(--ts-border)",
          marginBottom: "var(--ts-space-xl)",
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.active}
            onClick={() => navigate(tab.to)}
            className="whitespace-nowrap"
            style={{
              height: "var(--ts-size-touch-min)",
              padding: "0 var(--ts-space-lg)",
              background: "transparent",
              color: tab.active ? "var(--ts-text-bright)" : "var(--ts-muted)",
              fontWeight: tab.active ? 700 : 500,
              fontSize: 14,
              boxShadow: `inset 0 -2px 0 ${tab.active ? "var(--ts-accent)" : "transparent"}`,
              transition: "box-shadow var(--ts-motion-base) var(--ts-ease-standard)",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        className="grid"
        style={{
          gap: "var(--ts-space-xl)",
          gridTemplateColumns: isGeneral ? "minmax(0,1fr)" : "minmax(0,1fr)",
        }}
      >
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          {/* Group index — only under "Allgemein", where there is more than one
              group to move between. Below md it becomes a chip row rather than
              a sidebar, because a 240px column on a 390px screen is the page. */}
          {isGeneral && (
            <nav
              aria-label={t("settings:sectionPicker", { defaultValue: "Bereich" })}
              className="flex shrink-0 gap-1 overflow-x-auto scrollbar-none md:w-60 md:flex-col md:overflow-visible"
            >
              {generalGroups.map((g) => {
                const active = g.id === group!.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => navigate(`/settings/${g.id}`)}
                    className="whitespace-nowrap text-left md:w-full"
                    style={{
                      minHeight: "var(--ts-size-touch-min)",
                      padding: "0 var(--ts-space-lg)",
                      borderRadius: "var(--ts-radius-button)",
                      background: active ? "var(--ts-tile)" : "transparent",
                      color: active ? "var(--ts-text-bright)" : "var(--ts-muted)",
                      fontWeight: active ? 700 : 500,
                      fontSize: 14,
                      border: active ? "1px solid var(--ts-border)" : "1px solid transparent",
                      transition: "background var(--ts-motion-fast) var(--ts-ease-standard)",
                    }}
                  >
                    {t(g.labelKey)}
                  </button>
                );
              })}
            </nav>
          )}

          <div className="min-w-0 flex-1 space-y-6">
            {/* Each section is a landmark with the id its old `?section=` link
                used, so a bookmark scrolls to the card rather than merely to
                the page. The name is an aria-label, not a heading: every
                section already renders its own title, and a second copy would
                read the same words twice to a screen reader. */}
            {sections.map((id) => (
              <section key={id} id={`settings-${id}`} aria-label={t(SECTION_LABEL_KEY[id])}>
                <SettingsSectionSwitch section={id} page={page} />
              </section>
            ))}

            {/* Auto-save strip. It reports what actually happened: a hint while
                idle, "saving" during the write, a confirmation for a few seconds
                after one lands. It used to be a permanent green checkmark
                reading "Auto-saved", which is why a flight default silently
                failing to persist looked like a success (issue #198). */}
            {AUTO_SAVED_GROUPS.has(group!.id) && (
              <div
                role="status"
                aria-live="polite"
                className="flex items-center justify-between"
                style={{
                  gap: "var(--ts-space-md)",
                  padding: "var(--ts-space-sm) var(--ts-space-lg)",
                  borderRadius: "var(--ts-radius-button)",
                  background: page.autoSaveState === "saved" ? "transparent" : "var(--ts-surface2)",
                  border: `1px solid ${
                    page.autoSaveState === "saved" ? "var(--ts-good)" : "var(--ts-border)"
                  }`,
                }}
              >
                <span
                  className="t-caption"
                  style={{
                    color: page.autoSaveState === "saved" ? "var(--ts-good)" : "var(--ts-muted)",
                  }}
                >
                  {page.autoSaveState === "saved"
                    ? t("settings:autoSave.saved")
                    : page.autoSaveState === "saving"
                      ? t("settings:autoSave.saving")
                      : t("settings:autoSave.idle")}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {page.showPasswordModal && (
        <PasswordModal
          passwordForm={page.passwordForm}
          passwordError={page.passwordError}
          changingPassword={page.changingPassword}
          onClose={page.closePasswordModal}
          onSubmit={page.handlePasswordChange}
          onSetPasswordForm={page.setPasswordForm}
        />
      )}
    </AppShell>
  );
}

/**
 * Lands every pre-2.7 settings URL on its new route.
 *
 * `/settings`, `/settings?tab=cruise`, `/settings?section=devices` and
 * `/settings#homeAirport` were all live links in bookmarks, chat logs and issue
 * bodies. They keep working: the section is looked up in the group table, so
 * this never needs a second list that can go stale, and the section name rides
 * along in the query so the target page can scroll to it.
 */
export function SettingsLegacyRedirect(): JSX.Element {
  const [searchParams] = useSearchParams();
  const { user } = useSettingsPage();
  const raw = searchParams.get("section") ?? window.location.hash.slice(1);
  const section = normalizeLegacySection(raw);

  // `?section=admin` used to open a section whose only content was a link to
  // /admin. The section is gone, the bookmarks are not.
  if (section === "admin" && (user?.isAdmin ?? false)) return <Navigate to="/admin" replace />;

  const group = section ? groupOfSection(section) : undefined;
  if (group) return <Navigate to={`/settings/${group.id}?section=${section}`} replace />;

  const tab = searchParams.get("tab");
  const tabGroup = tab && tab !== "general" ? findGroup(tab) : undefined;
  return <Navigate to={`/settings/${tabGroup?.id ?? DEFAULT_GROUP}`} replace />;
}

/**
 * Old ids that no longer name a section. `apiKeys`/`apikeys` predate the rename
 * to `externalServices` (#182); `general` was never a section at all, only a
 * tab, and arrived here through hand-written links.
 */
function normalizeLegacySection(raw: string): string {
  const aliases: Record<string, string> = {
    apiKeys: "externalServices",
    apikeys: "externalServices",
  };
  return Object.prototype.hasOwnProperty.call(aliases, raw) ? aliases[raw] : raw;
}
