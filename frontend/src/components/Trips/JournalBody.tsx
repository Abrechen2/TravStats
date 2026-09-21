import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import type { JSX } from "react";

/**
 * A diary entry's body, rendered in full.
 *
 * Shared by the read-only modal and the timeline card's expanded panel, so
 * the same entry cannot render one way in one place and another way two
 * clicks later. Links are user-authored: they open detached, so the target
 * page cannot reach back into the app. (react-markdown already sanitizes
 * `javascript:` URLs by default.)
 */
const MARKDOWN_COMPONENTS: Components = {
  a: ({ children, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export default function JournalBody({ body }: { body: string }): JSX.Element {
  return (
    <div className="trip-markdown">
      <ReactMarkdown components={MARKDOWN_COMPONENTS}>{body}</ReactMarkdown>
    </div>
  );
}
