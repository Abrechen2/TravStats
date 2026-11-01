import type { JSX, ReactNode } from "react";
import AppShell from "../../ui/AppShell";
import PageHeader from "../../ui/PageHeader";
import { SettingsMenuColumn, SettingsMenuCompact, type SettingsMenuGroup } from "./SettingsMenu";
import { SectionChips, type SectionChip } from "./SectionChips";
import { SettingsLevelSwitch } from "./SettingsLevelSwitch";
import { useStableScrollbar } from "./useStableScrollbar";
import { SettingsBreadcrumb } from "./SettingsBreadcrumb";

interface Props {
  /** The menu's landmark name. */
  navLabel: string;
  groups: SettingsMenuGroup[];
  activePage: string;
  hiddenPages: number;
  search: ReactNode;
  /** How many more settings Experte shows (the sidebar's level switch says so). */
  moreExpert: number;
  /** Under the menu column. */
  menuFooter?: ReactNode;
  /** The page title — the active menu entry's label, word for word. */
  title: string;
  meta?: ReactNode;
  chips: readonly SectionChip[];
  anchorPrefix: string;
  activeSection: string | null;
  onJump: (section: string) => void;
  /** Said above the sections: a deep link that could not be honoured, an expert page. */
  notice?: ReactNode;
  children: ReactNode;
}

/**
 * The frame of the one settings area (forgejo#321): the sticky menu on the left
 * — search, level switch, pages — and on the right the page: its title, the
 * section chips and the sections. The scrollbar's gutter is reserved while it is open,
 * so moving between a long page and a short one does not shift the layout.
 */
export function SettingsLayout({
  navLabel,
  groups,
  activePage,
  hiddenPages,
  search,
  moreExpert,
  menuFooter,
  title,
  meta,
  chips,
  anchorPrefix,
  activeSection,
  onJump,
  notice,
  children,
}: Props): JSX.Element {
  useStableScrollbar();
  const menu = {
    label: navLabel,
    groups,
    activeId: activePage,
    hiddenPages,
    search,
    levelSwitch: <SettingsLevelSwitch moreCount={moreExpert} />,
  };
  return (
    <AppShell width="list">
      <div
        className="grid md:grid-cols-[240px_minmax(0,1fr)]"
        style={{ gap: "var(--ts-space-xxl)" }}
      >
        <div className="hidden md:block">
          <SettingsMenuColumn {...menu} footer={menuFooter} />
        </div>

        <div className="flex min-w-0 flex-col" style={{ gap: "var(--ts-space-xl)" }}>
          <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
            <SettingsBreadcrumb page={title} />
            <PageHeader title={title} meta={meta} />
          </div>
          <div className="md:hidden">
            <SettingsMenuCompact {...menu} />
          </div>
          {notice}
          <SectionChips
            chips={chips}
            anchorOf={(id) => `${anchorPrefix}-${id}`}
            active={activeSection}
            onJump={onJump}
          />
          {children}
          {/* On a phone the column is not there; the version still is. */}
          {menuFooter ? <div className="md:hidden">{menuFooter}</div> : null}
        </div>
      </div>
    </AppShell>
  );
}
