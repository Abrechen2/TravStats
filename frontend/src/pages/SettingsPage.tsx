import { useCallback, useEffect, useMemo, type JSX } from "react";
import { Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "../hooks/useTranslation";
import { useSettingsPage, type AutoSaveState } from "../components/Settings/useSettingsPage";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useBetaFeatures } from "../hooks/useBetaFeatures";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { useDomainColors } from "../hooks/useDomainColors";
import { useSectionInView } from "../hooks/useSectionInView";
import { useEffectiveSettingsLevel } from "../store/settingsLevelStore";
import PasswordModal from "../components/Settings/PasswordModal";
import { SettingsLayout } from "../components/Settings/frame/SettingsLayout";
import { SectionFrame } from "../components/Settings/frame/SectionFrame";
import { PageExpertNote } from "../components/Settings/frame/ExpertNote";
import { VersionLine } from "../components/Settings/frame/VersionLine";
import {
  PageHiddenRowsContext,
  useHiddenRowsCollector,
} from "../components/Settings/frame/useExpertRows";
import { DomainOffNotice } from "../components/Settings/frame/DomainOffNotice";
import type { SettingsMenuGroup } from "../components/Settings/frame/SettingsMenu";
import SettingsSectionSwitch from "./Settings/SettingsSectionSwitch";
import { SettingsSearch } from "./Settings/SettingsSearch";
import { useSearchScopes } from "./Settings/useSearchScopes";
import { resolveSettingsLink } from "./Settings/settingsLinks";
import { pageLevel, sectionsOf } from "./Settings/surface";
import {
  MOVED_TO_ADMIN,
  SETTINGS_MENU,
  SETTINGS_PAGES,
  findPage,
  type SettingsPageDef,
} from "./Settings/settingsModel";

/**
 * Pages whose sections write through the settings store's auto-save, and
 * therefore drive `autoSaveState`. Elsewhere the sections save explicitly or
 * not at all, and the strip would promise something that never happens (UAT B8).
 */
const AUTO_SAVED_PAGES = new Set(["account", "display", "flight", "cruise"]);

/** A landed write reads good, a failed one bad; waiting and writing stay quiet. */
const AUTO_SAVE_COLOR: Record<AutoSaveState, string> = {
  idle: "var(--ts-muted)",
  pending: "var(--ts-muted)",
  saving: "var(--ts-muted)",
  saved: "var(--ts-good)",
  failed: "var(--ts-bad)",
};

/** The section an address names: `?section=` or, in pre-2.7 links, the hash. */
function useNamedSection(): string | null {
  const [searchParams] = useSearchParams();
  const { hash } = useLocation();
  return searchParams.get("section") || hash.slice(1) || null;
}

/**
 * Einstellungen — one page per menu entry (forgejo#321).
 *
 * Every address first goes through `resolveSettingsLink`; anything that is not
 * already the canonical address of a page and section is redirected to it, so
 * the page itself only ever renders a page it knows.
 */
export default function SettingsPage(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  // `:group` is the route's name before pages (2.7.x); both name the page.
  const params = useParams<{ page?: string; group?: string }>();
  const pageParam = params.page ?? params.group;
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const page = useSettingsPage();
  const { isFeatureVisible } = useBetaFeatures();
  const { isEnabled } = useEnabledDomains();
  const { colorOf } = useDomainColors();
  const level = useEffectiveSettingsLevel();
  const named = useNamedSection();
  const isAdmin = page.user?.isAdmin ?? false;
  const searchScopes = useSearchScopes(isAdmin);

  const isReachable = useCallback(
    (p: SettingsPageDef) => !p.domain || isEnabled(p.domain),
    [isEnabled]
  );
  const canonical = resolveSettingsLink({
    page: pageParam,
    section: named,
    tab: searchParams.get("tab"),
    isAdmin,
    isReachable,
  });
  const current = findPage(pageParam);
  const target = new URL(canonical, "http://x");
  const isCanonical =
    target.pathname === location.pathname &&
    (target.searchParams.get("section") ?? null) === searchParams.get("section") &&
    !location.hash &&
    !searchParams.get("tab");

  // The page of a switched-off domain says so instead of drawing its settings.
  const domainOff = current?.domain && !isEnabled(current.domain) ? current.domain : null;
  const visible = useMemo(
    () =>
      current && !domainOff
        ? sectionsOf(current, { level, isGateOpen: isFeatureVisible, isAdmin, deepLinked: named })
        : { shown: [], hiddenExpert: 0, hiddenExpertSettings: 0, deepLinkedExpert: null },
    [current, domainOff, level, isFeatureVisible, isAdmin, named]
  );
  const inView = useSectionInView(visible.shown, "settings");
  // Every setting the standard level keeps off this page — whole expert
  // sections and the expert rows of standard ones — for the note at its top.
  const [hiddenRows, reportHiddenRows] = useHiddenRowsCollector();
  const hiddenSettings = visible.hiddenExpertSettings + hiddenRows;
  const title = current ? t(current.labelKey) : "";
  useDocumentTitle(
    current
      ? `TravStats – ${t("settings:title", { defaultValue: "Einstellungen" })} – ${title}`
      : null
  );

  // Scroll a named section into view once the page has rendered: a bookmark
  // lands on the card, not merely on the page.
  useEffect(() => {
    if (!isCanonical || !named) return;
    const el = document.getElementById(`settings-${named}`);
    // Feature-checked: jsdom has no layout, so the method is absent there.
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [isCanonical, named]);

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

  if (!isCanonical || !current) return <Navigate to={canonical} replace />;

  const reachablePages = SETTINGS_PAGES.filter(isReachable);
  const inMenu = (p: SettingsPageDef): boolean =>
    level === "expert" || pageLevel(p) === "standard" || p.id === current.id;
  const groups: SettingsMenuGroup[] = SETTINGS_MENU.map((g) => ({
    id: g.id,
    label: g.labelKey ? t(g.labelKey) : null,
    entries: reachablePages
      .filter((p) => g.pages.includes(p.id) && inMenu(p))
      .map((p) => ({
        id: p.id,
        label: t(p.labelKey),
        to: `/settings/${p.id}`,
        icon: p.icon,
        color: p.domain ? colorOf(p.domain) : undefined,
      })),
  })).filter((g) => g.entries.length > 0);
  const hiddenPages = reachablePages.filter((p) => !inMenu(p)).length;

  // A link named a section that moved to administration, opened by an account
  // without it: say so instead of leaving the address and the screen to disagree.
  const adminOnlyNotice =
    named !== null && !isAdmin && Object.prototype.hasOwnProperty.call(MOVED_TO_ADMIN, named);
  const labelOf = (id: string): string =>
    t(current.sections.find((s) => s.id === id)?.labelKey ?? id);

  return (
    <SettingsLayout
      surface="settings"
      isAdmin={isAdmin}
      navLabel={t("settings:title", { defaultValue: "Einstellungen" })}
      groups={groups}
      activePage={current.id}
      hiddenPages={hiddenPages}
      search={<SettingsSearch scopes={searchScopes} />}
      menuFooter={<VersionLine />}
      title={title}
      meta={
        <span>
          <span>{t("settings:scopeHint")}</span>
          {AUTO_SAVED_PAGES.has(current.id) && (
            <>
              {" · "}
              {/* The status reports what actually happened: a hint while idle,
                  "saving" during the write, a confirmation after one lands
                  (issue #198 — a permanent "Auto-saved" hid a failing write). */}
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
      chips={visible.shown.map((id) => ({ id, label: labelOf(id) }))}
      anchorPrefix="settings"
      activeSection={inView}
      onJump={jump}
      notice={
        domainOff ? (
          <DomainOffNotice domain={domainOff} />
        ) : adminOnlyNotice ? (
          <p
            role="status"
            className="t-caption"
            style={{
              padding: "12px 16px",
              borderRadius: "var(--ts-radius-card)",
              background: "var(--ts-surface2)",
              border: "1px solid var(--ts-border)",
              color: "var(--ts-text)",
            }}
          >
            {t("settings:deepLink.adminOnlySection")}
          </p>
        ) : (
          <PageExpertNote count={hiddenSettings} />
        )
      }
    >
      <PageHiddenRowsContext.Provider value={reportHiddenRows}>
        {visible.shown.map((id, index) => (
          <SectionFrame
            key={id}
            headingAbove={index === 0 ? title : null}
            anchorId={`settings-${id}`}
            label={labelOf(id)}
            expert={current.sections.find((s) => s.id === id)?.level === "expert"}
            deepLinkedExpert={visible.deepLinkedExpert === id}
            revealExpertRows={named === id && searchParams.get("expert") === "1"}
          >
            <SettingsSectionSwitch section={id} page={page} />
          </SectionFrame>
        ))}
      </PageHiddenRowsContext.Provider>

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
    </SettingsLayout>
  );
}

/**
 * `/settings` itself — every link written before settings had pages. The
 * resolution is the page's own, so the two can never disagree.
 */
export function SettingsLegacyRedirect(): JSX.Element {
  return <SettingsPage />;
}
