import { useCallback, useEffect, useMemo, useRef, type JSX } from "react";
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
import AboutSection from "../components/Settings/AboutSection";
import { SettingsLayout } from "../components/Settings/frame/SettingsLayout";
import { SectionFrame } from "../components/Settings/frame/SectionFrame";
import { ExpertPageNotice, PageExpertNote } from "../components/Settings/frame/ExpertNote";
import { VersionLine } from "../components/Settings/frame/VersionLine";
import {
  PageExpertNoteShownContext,
  PageHiddenRowsContext,
  useHiddenRowsCollector,
} from "../components/Settings/frame/useExpertRows";
import { DomainOffNotice } from "../components/Settings/frame/DomainOffNotice";
import type { SettingsMenuGroup } from "../components/Settings/frame/SettingsMenu";
import SettingsSectionSwitch from "./Settings/SettingsSectionSwitch";
import { useSectionConditions } from "./Settings/useSectionConditions";
import { useSearchHighlight } from "./Settings/useSearchHighlight";
import { AreaSearch } from "./Settings/area/AreaSearch";
import {
  AREA_MENU,
  AREA_PAGES,
  INDENTED_PAGES,
  findAreaPage,
  mountFor,
  type AreaPageDef,
  type AreaSectionDef,
} from "./Settings/area/areaModel";
import { resolveAddress } from "./Settings/area/redirects";
import { readLastPage, writeLastPage } from "./Settings/area/lastPage";
import { expertRowCount } from "./Settings/registry";
import { pageLevel, sectionsOf } from "./Settings/surface";
import type { SettingsSectionId } from "./Settings/settingsModel";
import type { AdminSectionId } from "./Admin/adminSections";
import { ADMIN_SECTION_FRAME } from "./Admin/AdminSectionSwitch";
import { AdminSectionBody } from "./Admin/AdminSectionBody";
import { usePublicUrlMissing } from "../components/ServerPages/usePublicUrlMissing";
import LeaveGuardHost from "../components/ui/settings/LeaveGuardHost";
import { useDeepLinkScroll } from "./Admin/useDeepLinkScroll";

/**
 * Pages whose sections write through the settings store's auto-save, and
 * therefore drive `autoSaveState`. Elsewhere the sections save explicitly or
 * not at all, and the strip would promise something that never happens (UAT B8).
 */
const AUTO_SAVED_PAGES = new Set(["account", "display", "domains", "flight", "cruise"]);

/**
 * Auto-saved pages that ALSO carry a group with its own save button (the
 * profile). Their idle hint names the exception instead of promising that
 * everything saves itself.
 */
const AUTO_SAVED_PAGES_WITH_BUTTONS = new Set(["account"]);

/** Locale key of the status line; only the idle hint differs per page. */
export function autoSaveKey(pageId: string, state: AutoSaveState): string {
  if (state === "idle" && AUTO_SAVED_PAGES_WITH_BUTTONS.has(pageId)) return "idleWithButtons";
  return state;
}

/** A landed write reads good, a failed one bad; waiting and writing stay quiet. */
const AUTO_SAVE_COLOR: Record<AutoSaveState, string> = {
  idle: "var(--ts-muted)",
  pending: "var(--ts-muted)",
  saving: "var(--ts-muted)",
  saved: "var(--ts-good)",
  failed: "var(--ts-bad)",
};

/** The section an address names: `#section`, or the pre-2.7 `?section=`. */
function namedAnchor(search: string, hash: string): string | null {
  const fromQuery = new URLSearchParams(search).get("section");
  if (fromQuery) return fromQuery;
  if (!hash.startsWith("#")) return null;
  try {
    return decodeURIComponent(hash.slice(1)) || null;
  } catch {
    return null;
  }
}

/** Which of the two scope lines a page carries (design §5.7). */
function scopeLineKey(page: AreaPageDef): string {
  if (page.adminOnly) return "settings:area.scope.instance";
  return page.id === "services" ? "settings:area.scope.mixed" : "settings:area.scope.account";
}

/**
 * Einstellungen — the one settings area (settings rebuild, package 1).
 *
 * Account settings and the server's live here together: `/settings/<page>`,
 * with `/admin/...` and every older `/settings/...` form redirecting through
 * `resolveAddress`. Anything that is not already the canonical address is
 * redirected, so the page itself only ever renders a page it knows. The
 * server's pages are drawn for an admin only; anyone else who follows such an
 * address lands on their own pages with a line that says why.
 */
export default function SettingsPage(): JSX.Element {
  const { t } = useTranslation(["settings", "common", "settingsRows"]);
  const params = useParams<{ page?: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const page = useSettingsPage();
  const { isFeatureVisible } = useBetaFeatures();
  const { isEnabled } = useEnabledDomains();
  const { colorOf } = useDomainColors();
  const level = useEffectiveSettingsLevel();
  const isAdmin = page.user?.isAdmin ?? false;
  const mainRef = useRef<HTMLDivElement>(null);

  const resolved = resolveAddress({
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    isAdmin,
    isDomainOn: isEnabled,
    lastPage: readLastPage(),
  });
  const isCanonical = resolved.to === `${location.pathname}${location.search}${location.hash}`;
  const current = findAreaPage(params.page);

  // `?service=` names a card of the catalogue: it stands in for the section when
  // the address carries no hash, so an expert or server card opens by it alone.
  const service = current?.id === "services" ? searchParams.get("service") : null;
  const anchor = isCanonical ? (namedAnchor(location.search, location.hash) ?? service) : null;
  const match = isCanonical ? searchParams.get("match") : null;
  const namedMount = current ? mountFor(current.id, anchor, match, isAdmin) : undefined;
  const named = namedMount?.id ?? null;

  // A page of a switched-off domain says so instead of drawing its settings.
  const domainOff = current?.domain && !isEnabled(current.domain) ? current.domain : null;
  const conditions = useSectionConditions();
  const travTrackHeld = conditions.travTrackHeld === true;
  const visible = useMemo(
    () =>
      current && !domainOff
        ? sectionsOf(current, {
            // An expert page (Wartung, Stammdaten) opened at the standard
            // level — by a link, the search or a bookmark — shows its
            // sections, with a note above, rather than an empty page.
            level: pageLevel(current) === "expert" ? "expert" : level,
            isGateOpen: isFeatureVisible,
            conditions: { travTrackHeld },
            isAdmin,
            deepLinked: named,
          })
        : { shown: [], hiddenExpert: 0, hiddenExpertSettings: 0, deepLinkedExpert: null },
    [current, domainOff, level, isFeatureVisible, travTrackHeld, isAdmin, named]
  );
  const inView = useSectionInView(visible.shown, "settings");
  // Every setting the standard level keeps off this page — whole expert
  // sections and the expert rows of standard ones — for the note at its top.
  const [hiddenRows, reportHiddenRows] = useHiddenRowsCollector();
  const highlighted = useSearchHighlight("settings");
  const hiddenSettings = visible.hiddenExpertSettings + hiddenRows;
  const title = current ? t(current.labelKey) : "";
  useDocumentTitle(
    current
      ? `TravStats – ${t("settings:title", { defaultValue: "Einstellungen" })} – ${title}`
      : null
  );

  useEffect(() => {
    if (isCanonical && current) writeLastPage(current.id);
  }, [isCanonical, current]);

  // Scroll a named section into view and keep it there while the page's lazy
  // sections settle: a bookmark lands on the card, not merely on the page.
  useDeepLinkScroll(mainRef, false, named, "settings");
  // B15: the server's public address is required; the menu and the Server page say when it is not there.
  const publicUrlMissing = usePublicUrlMissing(isAdmin);

  const jump = useCallback((section: string): void => {
    const el = document.getElementById(`settings-${section}`);
    // Feature-checked: jsdom has no layout, so the method is absent there.
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, []);

  // The state carries a search hit's highlight across the redirect, and a
  // permission note to the page the account lands on.
  if (!isCanonical || !current) {
    const carried = (location.state as Record<string, unknown> | null) ?? {};
    return (
      <Navigate
        to={resolved.to}
        replace
        state={resolved.adminOnly ? { ...carried, adminOnly: true } : location.state}
      />
    );
  }

  const adminOnlyNotice = (location.state as { adminOnly?: unknown } | null)?.adminOnly === true;
  const reachablePages = AREA_PAGES.filter(
    (p) => (!p.domain || isEnabled(p.domain)) && (!p.adminOnly || isAdmin)
  );
  const inMenu = (p: AreaPageDef): boolean =>
    level === "expert" || pageLevel(p) === "standard" || p.id === current.id;
  const groups: SettingsMenuGroup[] = AREA_MENU.map((g) => ({
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
        indent: INDENTED_PAGES.has(p.id),
        ...(p.id === "server" && publicUrlMissing
          ? { warn: { label: t("settingsRows:server.publicUrlMissing") } }
          : {}),
      })),
  })).filter((g) => g.entries.length > 0);
  const hiddenPages = reachablePages.filter((p) => !inMenu(p)).length;
  const moreExpert = expertRowCount({
    isAdmin,
    isDomainOn: isEnabled,
    isGateOpen: isFeatureVisible,
  });

  const mounts = new Map<string, AreaSectionDef>(current.sections.map((s) => [s.id, s]));
  const labelOf = (id: string): string => t(mounts.get(id)?.labelKey ?? id);
  const isExpertPage = pageLevel(current) === "expert" && level === "standard";

  const body = (mount: AreaSectionDef): JSX.Element => {
    if (mount.domain && !isEnabled(mount.domain)) return <DomainOffNotice domain={mount.domain} />;
    if (mount.source === "admin")
      return <AdminSectionBody section={mount.component as AdminSectionId} mountId={mount.id} />;
    if (mount.source === "about") return <AboutSection />;
    return <SettingsSectionSwitch section={mount.component as SettingsSectionId} page={page} />;
  };
  const frameOf = (mount: AreaSectionDef): "own" | "card" => {
    if (mount.domain && !isEnabled(mount.domain)) return "card";
    return mount.source === "admin"
      ? ADMIN_SECTION_FRAME[mount.component as AdminSectionId]
      : "own";
  };

  const sections = (
    <PageHiddenRowsContext.Provider value={reportHiddenRows}>
      <PageExpertNoteShownContext.Provider
        value={!domainOff && !isExpertPage && hiddenSettings > 0}
      >
        {/* Asks before a page with unsaved groups is left, and sends waiting writes. */}
        <LeaveGuardHost />
        <div ref={mainRef} className="flex min-w-0 flex-col" style={{ gap: "var(--ts-space-xl)" }}>
          {visible.shown.map((id, index) => {
            const mount = mounts.get(id)!;
            return (
              <SectionFrame
                key={id}
                headingAbove={index === 0 ? title : null}
                anchorId={`settings-${id}`}
                label={labelOf(id)}
                expert={mount.level === "expert"}
                frame={frameOf(mount)}
                deepLinkedExpert={visible.deepLinkedExpert === id && !isExpertPage}
                revealExpertRows={named === id && searchParams.get("expert") === "1"}
                highlighted={highlighted === id}
              >
                {body(mount)}
              </SectionFrame>
            );
          })}
        </div>
      </PageExpertNoteShownContext.Provider>
    </PageHiddenRowsContext.Provider>
  );

  return (
    <SettingsLayout
      navLabel={t("settings:title", { defaultValue: "Einstellungen" })}
      groups={groups}
      activePage={current.id}
      hiddenPages={hiddenPages}
      search={<AreaSearch isAdmin={isAdmin} />}
      moreExpert={moreExpert}
      menuFooter={<VersionLine />}
      title={title}
      meta={
        <span>
          <span>{t(scopeLineKey(current))}</span>
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
                {t(`settings:autoSave.${autoSaveKey(current.id, page.autoSaveState)}`)}
                {page.autoSaveState === "failed" && page.autoSaveReason
                  ? `: ${page.autoSaveReason}`
                  : ""}
              </span>
              {page.autoSaveState === "failed" && page.autoSaveRetryable && (
                <>
                  {" "}
                  <button type="button" className="btn-secondary" onClick={page.retryAutosave}>
                    {t("settings:autoSave.retry")}
                  </button>
                </>
              )}
            </>
          )}
        </span>
      }
      chips={visible.shown.map((id) => ({ id, label: labelOf(id) }))}
      anchorPrefix="settings"
      activeSection={inView}
      onJump={jump}
      notice={
        <>
          {adminOnlyNotice && (
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
              {t("settings:area.adminOnlyNotice")}
            </p>
          )}
          {current.id === "server" && publicUrlMissing && (
            <p
              role="status"
              data-public-url-warning=""
              className="t-caption flex flex-wrap items-center"
              style={{
                gap: "var(--ts-space-md)",
                padding: "12px 16px",
                borderRadius: "var(--ts-radius-card)",
                background: "var(--ts-surface2)",
                border: "1px solid var(--ts-warn)",
                color: "var(--ts-text)",
              }}
            >
              <span>{t("settingsRows:server.publicUrlBanner")}</span>
              <button type="button" className="btn-secondary" onClick={() => jump("addresses")}>
                {t("settingsRows:server.publicUrlBannerJump")}
              </button>
            </p>
          )}
          {domainOff ? (
            <DomainOffNotice domain={domainOff} />
          ) : isExpertPage ? (
            <ExpertPageNotice />
          ) : (
            <PageExpertNote count={hiddenSettings} />
          )}
        </>
      }
    >
      {sections}

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
