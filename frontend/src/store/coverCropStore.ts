import { create } from "zustand";

/**
 * "Frame this cover now" — raised right after a cover was chosen (upload,
 * album, trip photo, entry photo, suggestion) and read by the one
 * `CoverCropHost`. A store rather than a prop because five unrelated flows set
 * covers and the page that shows the editor is not the one that set it. Carries
 * the new URL so the editor does not wait for the trip to reload. Never persisted.
 */
export interface CoverCropRequest {
  tripId: string;
  coverImageUrl: string;
  /** Re-framing the current cover starts from its saved crop. */
  initialCrop: import("../lib/coverCrop").CoverCrop | null;
  /** Called after the crop was saved (or the editor closed), to reload the trip. */
  onDone?: () => void;
}

interface CoverCropState {
  request: CoverCropRequest | null;
  open: (request: CoverCropRequest) => void;
  close: () => void;
}

export const useCoverCropStore = create<CoverCropState>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));
