import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

/**
 * How much of the body is handed to the renderer. The card clamps to two lines,
 * so anything beyond this is never visible — but rendering a whole diary entry
 * into every timeline card would still cost the DOM. Cutting here is safe for
 * Markdown too: a pair of markers split by the cut can only dangle past the
 * clamp, where nothing shows it.
 */
const MAX_PREVIEW_CHARS = 400;

/**
 * Block-level Markdown is flattened to inline text. A heading, list or quote
 * rendered at full weight inside a two-line card would wreck the timeline's
 * rhythm — the point here is to show the *formatting of the words* (bold,
 * italic, code), not to reproduce the document.
 */
const PREVIEW_COMPONENTS: Components = {
  p: ({ children }) => <span>{children} </span>,
  h1: ({ children }) => <span>{children} </span>,
  h2: ({ children }) => <span>{children} </span>,
  h3: ({ children }) => <span>{children} </span>,
  h4: ({ children }) => <span>{children} </span>,
  h5: ({ children }) => <span>{children} </span>,
  h6: ({ children }) => <span>{children} </span>,
  ul: ({ children }) => <span>{children}</span>,
  ol: ({ children }) => <span>{children}</span>,
  li: ({ children }) => <span>{children} </span>,
  blockquote: ({ children }) => <span>{children}</span>,
  pre: ({ children }) => <span>{children}</span>,
  hr: () => null,
  // A picture cannot be previewed in two lines of text, and letting one load
  // would fire a request per card.
  img: () => null,
  // Same posture as the full view (JournalViewModal): user-authored links open
  // detached, so the target page cannot reach back into the app.
  a: ({ children, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

function cap(body: string): string {
  if (body.length <= MAX_PREVIEW_CHARS) return body;
  const cut = body.slice(0, MAX_PREVIEW_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}

/**
 * Compact, rendered preview of a diary entry body for the trip timeline card.
 *
 * Issue #231: the card used to print the Markdown source verbatim, so a bold
 * word showed up as "**wort**" while the same entry rendered correctly in the
 * modal.
 */
export default function JournalPreview({ body }: { body: string }): JSX.Element | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) return null;

  return (
    <span className="line-clamp-2">
      <ReactMarkdown components={PREVIEW_COMPONENTS}>{cap(trimmed)}</ReactMarkdown>
    </span>
  );
}
