import { api } from "./client";

/**
 * Positions the Companion captured with "Ort jetzt" before they had a name
 * (companion#90). The server holds them until the user names or dismisses
 * them. Enveloped router (`{success, data}`), like the rest of `/places`.
 */

export type PlaceCaptureStatus = "open" | "resolved" | "dismissed";

export interface PlaceCapture {
  id: string;
  clientId: string;
  lat: number;
  lon: number;
  accuracyM: number | null;
  /** ISO instant the phone took the position. */
  capturedAt: string;
  note: string | null;
  status: PlaceCaptureStatus;
  placeId: string | null;
  visitId: string | null;
  createdAt: string;
}

/** A new place by name, or one the reader already has. */
export type ResolveCaptureInput = { name: string; category?: string } | { placeId: string };

interface Envelope<T> {
  success: boolean;
  data: T;
}

export const placeCapturesApi = {
  async listOpen(): Promise<PlaceCapture[]> {
    const res = await api.get<Envelope<PlaceCapture[]>>("/places/captures", {
      params: { status: "open" },
    });
    return res.data.data;
  },
  async resolve(id: string, input: ResolveCaptureInput): Promise<PlaceCapture> {
    const res = await api.post<Envelope<PlaceCapture>>(`/places/captures/${id}/resolve`, input);
    return res.data.data;
  },
  async dismiss(id: string): Promise<PlaceCapture> {
    const res = await api.delete<Envelope<PlaceCapture>>(`/places/captures/${id}`);
    return res.data.data;
  },
};
