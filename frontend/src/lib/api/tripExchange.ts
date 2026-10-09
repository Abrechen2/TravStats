import { api } from "./client";
import type { PackageEntityAction, PackageProposalReason } from "./tripPackage";

/**
 * One trip as a `.travstats` file (spec 2026-10-09 S3). Mirrors the backend's
 * `services/trip/exchange/types.ts`; the server reads the file, builds the
 * proposal and writes it — this client only carries the file.
 */
export interface TripExportOptions {
  documents: boolean;
  photos: boolean;
  private: boolean;
}

export type TripFileEntryKind = "flight" | "stay" | "cruise" | "rail" | "rental" | "visit" | "stop";

export interface TripFileEntryProposal {
  key: string;
  kind: TripFileEntryKind;
  action: PackageEntityAction;
  id: string | null;
  reason?: PackageProposalReason;
  label: string;
  day: string | null;
}

export interface TripFileProposal {
  trip: {
    action: "create" | "attach";
    id: string | null;
    name: string;
    startDate: string | null;
    endDate: string | null;
    matchedBy: "bookingReference" | "dateOverlap" | null;
  };
  options: TripExportOptions;
  exportedAt: string;
  appVersion: string;
  bookings: Array<{
    key: string;
    action: "create" | "attach";
    id: string | null;
    reference: string | null;
    price: number | null;
    currency: string | null;
  }>;
  places: Array<{ key: string; action: "create" | "reuse"; id: string | null; name: string }>;
  entries: TripFileEntryProposal[];
  journal: { create: number; skip: number };
  documents: { create: number; skip: number };
  photos: { create: number; skip: number };
}

export interface TripFileCommitResult {
  tripId: string;
  created: number;
  attached: number;
  skipped: number;
  documents: { filed: number; skipped: number; refused: number };
  photos: number;
  proposal: TripFileProposal;
}

export interface DownloadedTripFile {
  blob: Blob;
  filename: string;
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

const flag = (on: boolean): "1" | "0" => (on ? "1" : "0");

function filenameFrom(disposition: unknown): string {
  const match = typeof disposition === "string" ? /filename="([^"]+)"/.exec(disposition) : null;
  return match?.[1] ?? "reise.travstats";
}

function form(file: File, tripName?: string): FormData {
  const body = new FormData();
  body.append("file", file);
  if (tripName) body.append("tripName", tripName);
  return body;
}

/**
 * The shared axios instance sends `application/json` on every request; a
 * multipart body under that header reaches multer as no file at all. Naming
 * `multipart/form-data` lets axios fill in the boundary itself.
 */
const MULTIPART = {
  headers: { "Content-Type": "multipart/form-data" },
  // A file with photos takes longer than a JSON call.
  timeout: 5 * 60 * 1000,
};

export const tripExchangeApi = {
  download: async (tripId: string, options: TripExportOptions): Promise<DownloadedTripFile> => {
    const res = await api.get<Blob>(`/trips/${tripId}/export`, {
      params: {
        documents: flag(options.documents),
        photos: flag(options.photos),
        private: flag(options.private),
      },
      responseType: "blob",
      timeout: 5 * 60 * 1000,
    });
    return { blob: res.data, filename: filenameFrom(res.headers["content-disposition"]) };
  },
  preview: async (file: File, tripName?: string): Promise<TripFileProposal> => {
    const { data } = await api.post<Envelope<{ proposal: TripFileProposal }>>(
      "/trips/import/preview",
      form(file, tripName),
      MULTIPART
    );
    return data.data.proposal;
  },
  commit: async (file: File, tripName?: string): Promise<TripFileCommitResult> => {
    const { data } = await api.post<Envelope<TripFileCommitResult>>(
      "/trips/import/commit",
      form(file, tripName),
      MULTIPART
    );
    return data.data;
  },
};
