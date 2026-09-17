import { useCallback, useEffect, useMemo } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import PageHeader from "../components/ui/PageHeader";
import { useTranslation } from "../hooks/useTranslation";
import { useSettingsPage, type AutoSaveState } from "../components/Settings/useSettingsPage";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useBetaFeatures } from "../hooks/useBetaFeatures";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { useSectionInView } from "../hooks/useSectionInView";
import PasswordModal from "../components/Settings/PasswordModal";
import SettingsSectionSwitch from "./Settings/SettingsSectionSwitch";
import {
  SettingsIndexColumn,
  SettingsIndexCompact,
  type SettingsIndexCategory,
} from "./Settings/SettingsIndex";
import { SECTION_LABEL_KEY } from "./Settings/sectionLabels";
import { SECTION_ICON } from "./Settings/sectionIcons";
import {
  DEFAULT_GROUP,
  GENERAL_CONTENT_ORDER,
  GENERAL_GROUP_IDS,
  GENERAL_ROUTE,
  SETTINGS_GROUPS,
  findGroup,
  gateOfSection,
  groupOfSection,
  isGeneralGroup,
  type SettingsSectionId,
} from "./Settings/settingsModel";

/**
 * Routes whose sections write through the settings store's auto-save, and
 * therefore drive `autoSaveState`. The account route holds display, units and
 * modules, which do. Everywhere else the sections save explicitly or not at
 * all, and the strip would promise something that never happens (UAT B8).
 */
const AUTO_SAVED_ROUTES = new Set(["account", "flight", "cruise", "lodging"]);

/** A landed write reads good, a failed one bad; waiting and writing stay quiet. */
const AUTO_SAVE_COLOR: Record<AutoSaveState, string> = {
  idle: "var(--ts-muted)",
  pending: "var(--ts-muted)",
  saving: "var(--ts-muted)",
  saved: "var(--ts-good)",
  failed: "var(--ts-bad)",
};

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
  const [, setSearchParams] = useSearchParams();
  const page = useSettingsPage();
  const { isFeatureVisible } = useBetaFeatures();
  const { isEnabled } = useEnabledDomains();
  const deepLinked = useDeepLinkedSection();
  const isAdmin = page.user?.isAdmin ?? false;

  const group = findGroup(groupParam);
  const groupIsReachable = group ? (group.domain ? isEnabled(group.domain) : true) : false;
  const isGeneral = group ? group.id === GENERAL_ROUTE : false;

  /**
   * Whether a section shows on its page.
   *
   * A gated section stays out — the beta switch decides that, and un-gating is
   * the owner's call, not a side effect of a layout change. It comes back the
   * moment a URL names it, because `?section=devices` is the only way to mint a
   * pairing code while the gate is closed.
   */
  const isShown = useCallback(
    (id: SettingsSectionId): boolean => {
      const gate = gateOfSection(id);
      if (gate && !isFeatureVisible(gate) && deepLinked !== id) return false;
      // Renders null for non-admins, so an index entry would lead to nothing.
      if (id === "lodgingPreferences" && !isAdmin) return false;
      return true;
    },
    [isFeatureVisible, deepLinked, isAdmin]
  );

  const sections = useMemo<SettingsSectionId[]>(() => {
    if (!group) return [];
    const order = isGeneral ? GENERAL_CONTENT_ORDER : group.sections;
    return order.filter(isShown);
  }, [group, isGeneral, isShown]);

  const categories = useMemo<SettingsIndexCategory[]>(() => {
    if (!group) return [];
    const entry = (id: SettingsSectionId): SettingsIndexCategory["entries"][number] => ({
      id,
      label: t(SECTION_LABEL_KEY[id]),
      icon: SECTION_ICON[id],
    });
    if (!isGeneral) {
      return [{ id: group.id, label: t(group.labelKey), entries: sections.map(entry) }];
    }
    return SETTINGS_GROUPS.filter((g) => isGeneralGroup(g.id))
      .map((g) => ({
        id: g.id,
        label: t(g.labelKey),
        entries: g.sections.filter(isShown).map(entry),
      }))
      .filter((category) => category.entries.length > 0);
  }, [group, isGeneral, sections, isShown, t]);

  const inView = useSectionInView(sections, "settings");

  const routeLabel = group
    ? isGeneral
      ? t("settings:tabs.general", { defaultValue: "Allgemein" })
      : t(group.labelKey)
    : "";
  useDocumentTitle(
    group
      ? `TravStats – ${t("settings:title", { defaultValue: "Einstellungen" })} – ${routeLabel}`
      : null
  );

  // Scroll a named section into view once the page has rendered. The anchor
  // survives from the old `?section=` links, so a five-year-old bookmark still
  // lands on the right card instead of merely the right page.
  useEffect(() => {
    if (!deepLinked || !groupIsReachable) return;
    const el = document.getElementById(`settings-${deepLinked}`);
    // Feature-checked: jsdom has no layout, so the method is absent there.
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [deepLinked, groupIsReachable]);

  const jump = useCallback(
    (section: string): void => {
      setSearchParams({ section }, { replace: true });
      const el = document.getElementById(`settings-${section}`);
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    },
    [setSearchParams]
  );

  if (!groupIsReachable) return <Navigate to={`/settings/${DEFAULT_GROUP}`} replace />;

  // Konto, Darstellung, Daten and Dienste were routes until round 4 made them
  // anchors on one page. Their URLs are in bookmarks: land on the anchor.
  if (group && isGeneralGroup(group.id) && !isGeneral) {
    const first = group.sections.find(isShown) ?? group.sections[0];
    return <Navigate to={`/settings/${GENERAL_ROUTE}?section=${first}`} replace />;
  }

  const tabs = [
    {
      id: "general",
      label: t("settings:tabs.general", { defaultValue: "Allgemein" }),
      to: `/settings/${GENERAL_ROUTE}`,
      active: isGeneral,
    },
    ...SETTINGS_GROUPS.filter((g) => g.domain && isEnabled(g.domain)).map((g) => ({
      id: g.id,
      label: t(g.labelKey),
      to: `/settings/${g.id}`,
      active: group?.id === g.id,
    })),
  ];

  return (
    <AppShell width="list">
      <div
        className="grid md:grid-cols-[240px_minmax(0,1fr)]"
        style={{ gap: "var(--ts-space-xxl)" }}
      >
        <div className="hidden md:block">
          <SettingsIndexColumn tabs={tabs} categories={categories} active={inView} onJump={jump} />
        </div>

        <div className="min-w-0 flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
          <PageHeader
            title={t("settings:title", { defaultValue: "Einstellungen" })}
            meta={
              <span>
                <span>{t("settings:scopeHint")}</span>
                {AUTO_SAVED_ROUTES.has(group!.id) && (
                  <>
                    {" · "}
                    {/* The status reports what actually happened: a hint while
                        idle, "saving" during the write, a confirmation after
                        one lands (issue #198 — a permanent "Auto-saved" hid a
                        failing write). */}
                    <span
                      role="status"
                      aria-live="polite"
                      style={{
                        fontFamily: "var(--ts-font-mono)",
                        color: AUTO_SAVE_COLOR[page.autoSaveState],
                      }}
                    >
                      {t(`settings:autoSave.${page.autoSaveState}`)}
                    </span>
                  </>
                )}
              </span>
            }
          />

          {/* Phone layout of the index: jump menu and route pills. */}
          <div className="md:hidden">
            <SettingsIndexCompact
              tabs={tabs}
              categories={categories}
              active={inView}
              onJump={jump}
            />
          </div>

          {/* Each section is a landmark with the id its old `?section=` link
              used. The name is an aria-label: the section draws its own
              heading, and a second copy would be read twice. */}
          {sections.map((id) => (
            <section
              key={id}
              id={`settings-${id}`}
              aria-label={t(SECTION_LABEL_KEY[id])}
              style={{ scrollMarginTop: "calc(var(--ts-size-web-header) + 16px)" }}
            >
              <SettingsSectionSwitch section={id} page={page} />
            </section>
          ))}

          {/* The last section must be able to reach the top of the viewport,
              or its menu entry can never become active — the tester could not
              open "Über TravStats" at all. AppShell's own bottom padding
              (80px) is not enough once a section's scrollMarginTop is added
              on top of it, so the document needs extra scrollable room below
              the last card. */}
          <div
            aria-hidden
            data-testid="settings-scroll-tail"
            style={{ minHeight: "calc(100vh - var(--ts-size-web-header) - 120px)" }}
          />
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
 * along in the query so the target page can scroll to it. A section of a
 * general group lands on the general route, where it is an anchor.
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
  if (group) {
    const route = isGeneralGroup(group.id) ? GENERAL_ROUTE : group.id;
    return <Navigate to={`/settings/${route}?section=${section}`} replace />;
  }

  const tab = searchParams.get("tab");
  const tabGroup = tab && tab !== "general" ? findGroup(tab) : undefined;
  const route =
    tabGroup && !(GENERAL_GROUP_IDS as readonly string[]).includes(tabGroup.id)
      ? tabGroup.id
      : DEFAULT_GROUP;
  return <Navigate to={`/settings/${route}`} replace />;
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
