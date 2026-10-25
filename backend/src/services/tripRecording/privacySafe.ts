import type { ZoneCircle } from "../travtrack/classify";
import { privacyCutBy } from "../travtrack/privacyCut";
import { localDayReader } from "./localDays";
import { splitAtGaps, type DevicePoints, type RecordingBreak, type StoredPoint } from "./segments";

/**
 * A trip recording as far as the privacy zones let it be described (TravTrack
 * plan T5, review focus 10): every point inside a circle, and every point the
 * cut leaves standing alone between two chords through one, taken out BEFORE
 * anything is counted. The summary, the recorded days, the device list, the
 * jitter count, the map and the GPX are all read from this — a recording
 * wholly inside a zone answers like no recording at all, never with an empty
 * line beside its activity summary.
 *
 * Where points were taken out the line keeps a break (`RecordingBreak`), so
 * nothing downstream joins the two stretches either side of a zone again.
 */

const coord = (p: StoredPoint): [number, number] => [p[2], p[1]];

export function privacySafeDevices(
  devices: readonly DevicePoints[],
  circles: readonly ZoneCircle[]
): DevicePoints[] {
  if (circles.length === 0) return [...devices];
  return devices.flatMap((device) => {
    // A stretch of one fix is a stretch the cut did not make: kept unless it lies inside.
    const pieces = splitAtGaps(device.points, device.breaks).flatMap((stretch) =>
      stretch.length === 1
        ? privacyCutBy([[stretch[0], stretch[0]]], circles, coord).map(() => stretch)
        : privacyCutBy([stretch], circles, coord)
    );
    if (pieces.length === 0) return [];
    const breaks: RecordingBreak[] = [...(device.breaks ?? [])];
    for (let k = 1; k < pieces.length; k++) {
      const before = pieces[k - 1];
      breaks.push([before[before.length - 1][0], pieces[k][0][0]]);
    }
    return [{ deviceId: device.deviceId, points: pieces.flat(), breaks }];
  });
}

/** The same devices narrowed to one day on the trip's clock; breaks kept. */
export function devicesOnDay(
  devices: readonly DevicePoints[],
  zone: string,
  day: string
): DevicePoints[] {
  const dayOf = localDayReader(zone);
  return devices
    .map((d) => ({ ...d, points: d.points.filter((p) => dayOf(p[0]) === day) }))
    .filter((d) => d.points.length > 0);
}
