import { useContext, useEffect, type JSX, type ReactNode } from "react";
import {
  ExpertSectionContext,
  HeadingAboveContext,
  SectionCard,
  SectionTitle,
} from "../SettingsShared";
import { DeepLinkedExpertNote, ExpertNote, RevealedRowsNote } from "./ExpertNote";
import {
  HiddenRowsContext,
  PageHiddenRowsContext,
  RevealExpertRowsContext,
  useHiddenRowsCollector,
} from "./useExpertRows";

interface SectionFrameProps {
  /** The DOM id anchors and `?section=` links target, e.g. `settings-units`. */
  anchorId: string;
  /** The section's name — its heading, chip and landmark name. */
  label: string;
  /**
   * `own`: the component draws its heading and card itself (`SectionCard` +
   * `SectionTitle`, the personal sections). `card`: the frame draws both, for
   * admin sections whose bodies predate the shared card.
   */
  frame?: "own" | "card";
  /** The section is expert-only and on the page only because a link named it. */
  deepLinkedExpert?: boolean;
  /**
   * The heading drawn right above this section — the page title, for the
   * first section of a page. A section heading with the same words is left
   * out: "Benutzer" under "Benutzer" says nothing twice.
   */
  headingAbove?: string | null;
  /** A link named this section's expert rows: show them, and say why. */
  revealExpertRows?: boolean;
  /** The section is expert-only: its heading carries the blue "Experte" pill. */
  expert?: boolean;
  /** A search hit landed here: the section is marked for a moment. */
  highlighted?: boolean;
  children: ReactNode;
}

/**
 * One section of a settings page: a landmark named after its heading, one
 * card, and — when the standard level hides some of its rows — the line that
 * says how many and offers the expert view.
 *
 * The uniform frame the tester asked for (forgejo#321): every section is a
 * mono heading and one card, at the same spacing, with the same words the
 * page's chips use. The landmark name is an aria-label rather than
 * aria-labelledby because the personal sections draw their own heading
 * inside their component.
 */
export function SectionFrame({
  anchorId,
  label,
  frame = "own",
  deepLinkedExpert = false,
  headingAbove = null,
  revealExpertRows = false,
  expert = false,
  highlighted = false,
  children,
}: SectionFrameProps): JSX.Element {
  const [hidden, report] = useHiddenRowsCollector();
  // Passed up to the page, whose top note counts every hidden setting on it.
  const reportToPage = useContext(PageHiddenRowsContext);
  useEffect(() => {
    if (!reportToPage) return;
    reportToPage(anchorId, hidden);
    return () => reportToPage(anchorId, 0);
  }, [reportToPage, anchorId, hidden]);

  return (
    <section
      id={anchorId}
      aria-label={label}
      data-highlighted={highlighted ? "true" : undefined}
      className="flex flex-col"
      style={{
        gap: "var(--ts-space-sm)",
        scrollMarginTop: "calc(var(--ts-size-web-header) + 16px)",
        borderRadius: "var(--ts-radius-card)",
        // The search's landing mark: an outline that fades, never a layout shift.
        outline: highlighted ? "2px solid var(--ts-accent)" : "2px solid transparent",
        outlineOffset: 6,
        transition: "outline-color 600ms var(--ts-ease-standard)",
      }}
    >
      {deepLinkedExpert && <DeepLinkedExpertNote />}
      {revealExpertRows && !deepLinkedExpert && <RevealedRowsNote />}
      <RevealExpertRowsContext.Provider value={revealExpertRows}>
        <HiddenRowsContext.Provider value={report}>
          <HeadingAboveContext.Provider value={headingAbove}>
            <ExpertSectionContext.Provider value={expert}>
              {frame === "card" ? (
                <SectionCard>
                  <SectionTitle title={label} />
                  {children}
                </SectionCard>
              ) : (
                children
              )}
            </ExpertSectionContext.Provider>
          </HeadingAboveContext.Provider>
        </HiddenRowsContext.Provider>
      </RevealExpertRowsContext.Provider>
      <ExpertNote count={hidden} />
    </section>
  );
}
