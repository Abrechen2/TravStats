import { api } from "./client";
import type {
  CreatedShareLink,
  ShareLinkKind,
  ShareLinkList,
  ShareView,
} from "../../types/shareLinks";

/**
 * Public share links (`/api/v1/share-links`, forgejo#281). Enveloped
 * (`{success, data}`, ADR 0001). A failure is thrown as the axios error;
 * `shareLinkErrorKey` turns its code into the sentence the user sees.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
}

export interface ShareLinkSelection {
  kind: ShareLinkKind;
  targetId: string;
  fields: string[];
}

export const shareLinksApi = {
  list: async (): Promise<ShareLinkList> => {
    const { data } = await api.get<Envelope<ShareLinkList>>("/share-links");
    return data.data;
  },

  preview: async (selection: ShareLinkSelection): Promise<ShareView> => {
    const { data } = await api.post<Envelope<{ view: ShareView }>>(
      "/share-links/preview",
      selection
    );
    return data.data.view;
  },

  create: async (
    selection: ShareLinkSelection & { expiresAt: string }
  ): Promise<CreatedShareLink> => {
    const { data } = await api.post<Envelope<CreatedShareLink>>("/share-links", selection);
    return data.data;
  },

  revoke: async (id: string): Promise<void> => {
    await api.delete(`/share-links/${encodeURIComponent(id)}`);
  },
};
