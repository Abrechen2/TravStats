import type { JSX } from "react";
import GapCalendar from "../../components/gap/GapCalendar";

/** The gap calendar as a Track tab (`/track/gaps`); TravTrack is on here, or the tab is not reachable. */
export default function TrackGaps(): JSX.Element {
  return <GapCalendar withTrack />;
}
