import type { JSX, ReactNode } from "react";
import AppShell from "../../ui/AppShell";
import PageHeader from "../../ui/PageHeader";
import { SettingsMenuColumn, SettingsMenuCompact, type SettingsMenuGroup } from "./SettingsMenu";
import { SectionChips, type SectionChip } from "./SectionChips";
import { SettingsLevelSwitch } from "./SettingsLevelSwitch";
import { useStableScrollbar } from "./useStableScrollbar";

interface Props {
  /** The menu's landmark name. */
  navLabel: string;
  groups: SettingsMenuGroup[];
  activePage: string;
  hiddenPages: number;
  search: ReactNode;
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
 * The frame both settings surfaces share (forgejo#321): the sticky menu on the
 * left, and on the right the page — its title, the level switch, the section
 * chips and the sections. The scrollbar's gutter is reserved while it is open,
 * so moving between a long page and a short one does not shift the layout.
 */
export function SettingsLayout({
  navLabel,
  groups,
  activePage,
  hiddenPages,
  search,
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
  const menu = { label: navLabel, groups, activeId: activePage, hiddenPages, search };
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
          <PageHeader title={title} meta={meta} actions={<SettingsLevelSwitch />} />
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
