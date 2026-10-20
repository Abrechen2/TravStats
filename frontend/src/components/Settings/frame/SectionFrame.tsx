import { useCallback, useState, type JSX, type ReactNode } from "react";
import { HeadingAboveContext, SectionCard, SectionTitle } from "../SettingsShared";
import { DeepLinkedExpertNote, ExpertNote } from "./ExpertNote";
import { HiddenRowsContext } from "./useExpertRows";

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
  children,
}: SectionFrameProps): JSX.Element {
  const [hiddenByKey, setHiddenByKey] = useState<Record<string, number>>({});
  const report = useCallback((key: string, hidden: number) => {
    setHiddenByKey((prev) => (prev[key] === hidden ? prev : { ...prev, [key]: hidden }));
  }, []);
  const hidden = Object.values(hiddenByKey).reduce((sum, n) => sum + n, 0);

  return (
    <section
      id={anchorId}
      aria-label={label}
      className="flex flex-col"
      style={{
        gap: "var(--ts-space-sm)",
        scrollMarginTop: "calc(var(--ts-size-web-header) + 16px)",
      }}
    >
      {deepLinkedExpert && <DeepLinkedExpertNote />}
      <HiddenRowsContext.Provider value={report}>
        <HeadingAboveContext.Provider value={headingAbove}>
          {frame === "card" ? (
            <SectionCard>
              <SectionTitle title={label} />
              {children}
            </SectionCard>
          ) : (
            children
          )}
        </HeadingAboveContext.Provider>
      </HiddenRowsContext.Provider>
      <ExpertNote count={hidden} />
    </section>
  );
}
