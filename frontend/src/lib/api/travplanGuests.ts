import { api } from "./client";
import { guestHttp } from "./guestHttp";
import type { PlanMember } from "../../types/travplan";

/** Remote guests of a plan and the plan's documents (forgejo#404, spec §6.5, D6). */
export interface GuestInvite {
  member: PlanMember;
  /** `https://<host>/plan/join#<id>.<secret>`; shown once, single use. */
  link: string;
  expiresAt: string;
}
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
export interface GuestSessionInfo {
  planId: string;
  tripId: string;
  planName: string;
  hostName: string;
  ownerName: string | null;
  expiresAt: string;
  memberId: string;
  displayName: string;
  origin: string;
  credential: "session" | "pat";
}
export interface JoinStart {
  vouchUrl: string;
  guestOrigin: string;
  host: string;
}

const multipart = { headers: { "Content-Type": "multipart/form-data" }, timeout: 120_000 };

export const travplanGuestsApi = {
  // The owner's side.
  invite: async (tripId: string, origin: string, username: string) =>
    (await api.post<GuestInvite>("/trips/" + tripId + "/plan/guests", { origin, username })).data,
  reinvite: async (tripId: string, memberId: string) =>
    (await api.post<GuestInvite>("/trips/" + tripId + "/plan/guests/" + memberId + "/invite")).data,
  // The guest's own server.
  vouchCheck: async (host: string) =>
    (await api.get<{ host: string }>("/federation/vouch/check", { params: { host } })).data,
  vouch: async (input: { host: string; invite: string; nonce: string }) =>
    (
      await api.post<{ redirectUrl: string; expiresAt: string; as: string }>(
        "/federation/vouch",
        input
      )
    ).data,
  // The host, before there is a session.
  startJoin: async (inviteId: string, secret: string) =>
    (await guestHttp.post<JoinStart>("/guest/join/start", { inviteId, secret })).data,
  completeJoin: async (vouch: string) =>
    (
      await guestHttp.post<{ planId: string; tripId: string; expiresAt: string }>(
        "/guest/join/complete",
        { vouch }
      )
    ).data,
  // The guest.
  session: async () => (await guestHttp.get<GuestSessionInfo>("/guest/session")).data,
  logout: async () => (await guestHttp.post<{ loggedOut: true }>("/guest/logout")).data,
  /** The plan's trip as a `.travstats` file (spec §6.6, §6.7); read-only on the host. */
  exportTrip: async (planId: string): Promise<{ blob: Blob; filename: string }> => {
    const res = await guestHttp.get<Blob>("/guest/plans/" + planId + "/export", {
      responseType: "blob",
      timeout: 5 * 60 * 1000,
    });
    const match = /filename="([^"]+)"/.exec(String(res.headers["content-disposition"] ?? ""));
    return { blob: res.data, filename: match?.[1] ?? "reise.travstats" };
  },
  leave: async () => (await guestHttp.post<{ left: true }>("/guest/leave")).data,
  /** A one-time pairing code for the Companion's QR; never the phone token itself. */
  pairingCode: async (planId: string) =>
    (
      await guestHttp.post<{ code: string; expiresAt: string }>(
        "/guest/plans/" + planId + "/pat/code"
      )
    ).data,
};

/** Plan documents for a co-planner on this server (`user`) or a guest (the guest door). */
export const planDocumentsApi = {
  list: async (tripId: string, guest: boolean) =>
    (
      await (guest ? guestHttp : api).get<{ documents: PlanDocument[] }>(
        "/trips/" + tripId + "/plan/documents"
      )
    ).data.documents,
  upload: async (tripId: string, file: File, guest: boolean) => {
    const form = new FormData();
    form.append("file", file);
    return (
      await (guest ? guestHttp : api).post<PlanDocument>(
        "/trips/" + tripId + "/plan/documents",
        form,
        multipart
      )
    ).data;
  },
};
