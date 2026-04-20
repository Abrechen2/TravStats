import { useEffect } from "react";

/**
 * Set `document.title` while the component is mounted and restore the
 * previous value on unmount. Used by pages that want the browser tab
 * and history entry to reflect their current state (e.g. the active
 * Settings tab) so back-button navigation and ⌘+Shift+A tab-switchers
 * stay readable.
 *
 * Pass `null` or an empty string to skip the update — useful when the
 * title depends on async data that hasn't loaded yet.
 */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (title === null || title === undefined || title === "") return;
    const previous = document.title;
    document.title = title;
    return (): void => {
      document.title = previous;
    };
  }, [title]);
}
