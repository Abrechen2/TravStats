import { useEffect, useState } from "react";

/**
 * The value, but only once it has stopped changing.
 *
 * For an input whose every keystroke would otherwise reach the server. The
 * flights logbook's search box is the case this was written for: it used to
 * filter rows the browser already held, so typing cost nothing; once the
 * search became a query parameter, "Lufthansa" would be nine requests, eight
 * of them for a prefix nobody wanted to see.
 *
 * 300 ms, in the range the two existing debounces in this tree already use
 * (350 ms for the Photon place search, 400 ms for Nominatim). Those talk to a
 * third party; this one talks to our own database, so it sits at the short
 * end.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
