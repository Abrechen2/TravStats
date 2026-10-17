import { api } from "./client";

/**
 * The calendar subscription (`/api/v1/calendar-feed`, forgejo#310). Enveloped
 * (`{success, data}`, ADR 0001). The URL is returned once, by `issue` — only
 * its hash is stored, so `status` can say THAT a URL exists, never which.
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
}

export interface IssuedCalendarFeed {
  url: string;
  webcalUrl: string;
  createdAt: string;
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
