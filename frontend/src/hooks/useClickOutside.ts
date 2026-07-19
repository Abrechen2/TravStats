import { useEffect, RefObject } from "react";

/**
 * Hook to detect clicks outside of a referenced element
 * @param ref - React ref object pointing to the element
 * @param handler - Callback function to execute when click outside is detected
 */
export function useClickOutside<T extends HTMLElement = HTMLElement>(
  // React 19's useRef<T>(null) yields RefObject<T | null>, so accept the
  // nullable form. The listener already guards `!ref.current`.
  ref: RefObject<T | null>,
  handler: (event: MouseEvent | TouchEvent) => void
): void {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      // Do nothing if clicking ref's element or descendent elements
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return;
      }
      handler(event);
    };

    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);

    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, handler]);
}
