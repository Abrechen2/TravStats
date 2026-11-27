import type { JSX } from "react";

import DocumentsSection from "../documents/DocumentsSection";
import RoadtripPhotosSection from "./RoadtripPhotosSection";

/**
 * What a roadtrip keeps beside its route: the evidence for the ride itself (a ride app's
 * screenshot or a PDF — GitHub #415) and its photographs. The documents hang off the
 * roadtrip, not off a station; images open in the shared photo viewer.
 */
export default function RoadtripAttachments({ roadtripId }: { roadtripId: string }): JSX.Element {
  return (
    <>
      <DocumentsSection entry={{ type: "tour", id: roadtripId }} previewImages />
      <RoadtripPhotosSection roadtripId={roadtripId} />
    </>
  );
}
