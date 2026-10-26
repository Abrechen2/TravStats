import { api } from "./client";

/**
 * The calendar subscription (`/api/v1/calendar-feed`, forgejo#310). Enveloped
 * (`{success, data}`, ADR 0001). `issue` returns the new URL; `status` lists
 * the live one again where the server can recover it (kept encrypted since
 * 2026-10-26) — null for one issued before that.
 * A failure is thrown as the axios error; `saveErrorKey` turns it into copy.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
}

export interface CalendarFeedStatus {
  /** The instance's beta switch: no URL is issued, or answered, while it is off. */
  enabled: boolean;
  active: boolean;
  createdAt: string | null;
  /** When a calendar app last read the URL; null when never. */
  lastUsedAt: string | null;
  /** The live URL; null without one, or for one issued before tokens were kept. */
  url: string | null;
  webcalUrl: string | null;
  /** False when the link's host is a private/loopback IP or `localhost`. */
  reachableFromInternet: boolean;
}

export interface IssuedCalendarFeed {
  url: string;
  webcalUrl: string;
  createdAt: string;
  /** False when the link's host is a private/loopback IP or `localhost`. */
  reachableFromInternet: boolean;
}

export const calendarFeedApi = {
  status: async (): Promise<CalendarFeedStatus> => {
    const { data } = await api.get<Envelope<CalendarFeedStatus>>("/calendar-feed");
    return data.data;
  },

  issue: async (): Promise<IssuedCalendarFeed> => {
    const { data } = await api.post<Envelope<IssuedCalendarFeed>>("/calendar-feed");
    return data.data;
  },

  revoke: async (): Promise<void> => {
    await api.delete("/calendar-feed");
  },
};
