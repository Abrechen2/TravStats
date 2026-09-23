import { api } from "./client";

/**
 * The sign-in page's background images.
 *
 * The list and the images themselves are served WITHOUT a session — the page
 * that shows them is what a visitor meets before one exists. Uploading and
 * removing are admin-only, which is where the real decision sits: an image
 * here is visible to anyone who can reach the instance.
 */

/** Where one image is fetched from — a path, so it works behind any host. */
export function loginBackgroundUrl(filename: string): string {
  return `/api/v1/login-backgrounds/${encodeURIComponent(filename)}`;
}

export async function getLoginBackgrounds(): Promise<string[]> {
  const { data } = await api.get<{ backgrounds: string[] }>("/login-backgrounds");
  return data.backgrounds;
}

export interface LoginBackgroundUpload {
  backgrounds: string[];
  accepted: string[];
  /** Original names of files that were not images. A partly-good upload keeps
   *  the good half rather than failing whole, so this can be non-empty on a
   *  successful call. */
  rejected: string[];
}

export async function uploadLoginBackgrounds(files: File[]): Promise<LoginBackgroundUpload> {
  const form = new FormData();
  for (const file of files) form.append("backgrounds", file);
  const { data } = await api.post<LoginBackgroundUpload>("/login-backgrounds", form);
  return data;
}

export async function deleteLoginBackground(filename: string): Promise<string[]> {
  const { data } = await api.delete<{ backgrounds: string[] }>(
    `/login-backgrounds/${encodeURIComponent(filename)}`
  );
  return data.backgrounds;
}
