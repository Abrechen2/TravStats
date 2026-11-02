import { api } from "./client";
import { isRemotePlanMode, remotePlanHttp } from "./remotePlans";

/** Documents on a plan (spec 2026-10-17 D6): a co-planner on this server, or a member from another. */
export interface PlanDocument {
  id: string;
  displayName: string;
  mimetype: string;
  format: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: { memberId: string; displayName: string } | null;
  bookingId: string | null;
  attached: boolean;
  url: string;
}

const multipart = { headers: { "Content-Type": "multipart/form-data" }, timeout: 120_000 };
/** The plan's calls go through the remote door while a plan on another server is open. */
const http = () => (isRemotePlanMode() ? remotePlanHttp : api);

export const planDocumentsApi = {
  list: async (tripId: string) =>
    (await http().get<{ documents: PlanDocument[] }>("/trips/" + tripId + "/plan/documents")).data
      .documents,
  upload: async (tripId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return (
      await http().post<PlanDocument>("/trips/" + tripId + "/plan/documents", form, multipart)
    ).data;
  },
};
