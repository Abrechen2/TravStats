import { runServerVectors } from "./runVectors";
import { loadVectors } from "./vectorFile";

/**
 * Child-process entry for `vectors.oddZones.test.ts`: runs the server vectors
 * under whatever `TZ` this process was started with and prints one JSON line.
 *
 * It also prints the zone the runtime ACTUALLY adopted and the host offset it
 * produces. Without that, a platform that ignored `TZ` would run the vectors
 * in the default zone and the odd-zone test would pass having proved nothing.
 */
const results = runServerVectors(loadVectors());
process.stdout.write(
  JSON.stringify({
    hostZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    // The host offset in January, in minutes west of UTC as the getter reports it.
    hostOffsetJanuary: new Date(Date.UTC(2027, 0, 15, 12)).getTimezoneOffset(),
    results,
  }) + "\n"
);
