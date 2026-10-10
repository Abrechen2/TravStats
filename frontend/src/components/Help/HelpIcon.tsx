import type { JSX } from "react";
import Toggletip from "../ui/Toggletip";
import type { ToggletipSide } from "../ui/toggletipPosition";

interface HelpIconProps {
  content: string;
  expandedContent?: string;
  position?: ToggletipSide;
  /** The field or figure the help is about — names the button (forgejo#249). */
  subject?: string;
  className?: string;
}

/**
 * The "?" beside a field or a figure. All behaviour — tap, keyboard, Escape,
 * focus return, touch sizing by pointer — lives in the shared `Toggletip`;
 * this is its glyph form, kept under the name every form already imports.
 */
export default function HelpIcon({
  content,
  expandedContent,
  position = "top",
  subject,
  className = "",
}: HelpIconProps): JSX.Element {
  return (
    <Toggletip
      content={<p className="whitespace-normal wrap-break-word">{content}</p>}
      expandedContent={
        expandedContent ? (
          <p className="whitespace-normal wrap-break-word">{expandedContent}</p>
        ) : undefined
      }
      position={position}
      subject={subject}
      className={className}
    />
  );
}
