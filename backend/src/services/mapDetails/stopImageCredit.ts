/**
 * Whom to credit for the photo on a station's map card (beta.23 UAT before
 * 2.7.0-rc.20: the Hamburg ZOB card showed a Commons photo credited to no one,
 * only "Text: Wikipedia"). The Wikipedia summary hands over a thumbnail URL and
 * nothing about it; the file's own page says who made it and under which
 * licence — the same fields the subject pictures carry.
 *
 * Asked through the article's edition, which answers for a Commons file and a
 * local one alike. A non-free file (fair use on the English edition) is not
 * shown outside Wikipedia at all. When the file page cannot be read, the
 * credit is still the link to it — never a photo with no source.
 */
import { z } from "zod";
import { fetchOpenData } from "../openData/http";
import type { WikiLanguage } from "../openData/wikipedia";
import { plainText } from "../operatorLogos/wikidataOperator";

export interface StopImageCredit {
  file: string;
  licence: string | null;
  licenceUrl: string | null;
  artist: string | null;
  /** The file's description page. */
  sourceUrl: string;
  /** Hosted on Wikimedia Commons, not on the edition itself. */
  onCommons: boolean;
}

/** `upload.wikimedia.org/wikipedia/<repo>/[thumb/]a/ab/<File>[/<size>px-<File>]`. */
const UPLOAD_PATH =
  /^https:\/\/upload\.wikimedia\.org\/wikipedia\/([a-z-]+)\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/;

const imageinfoSchema = z.object({
  query: z.object({
    pages: z.record(
      z.string(),
      z.object({
        imageinfo: z
          .array(
            z.object({
              descriptionurl: z.string().url().optional(),
              extmetadata: z
                .record(z.string(), z.object({ value: z.unknown() }).partial().optional())
                .optional(),
            })
          )
          .optional(),
      })
    ),
  }),
});

/** The file a thumbnail URL shows, or null for a URL that is not an upload. */
export function fileOfThumbnail(url: string): { file: string; onCommons: boolean } | null {
  const match = UPLOAD_PATH.exec(url);
  if (!match) return null;
  try {
    return { file: decodeURIComponent(match[2]), onCommons: match[1] === "commons" };
  } catch {
    return null;
  }
}

const capped = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, 300) : null;

/**
 * The credit for a summary's thumbnail; `"nonFree"` when it must not be shown;
 * null when the URL names no file (nothing to credit or link).
 */
export async function stopImageCredit(
  lang: WikiLanguage,
  thumbnailUrl: string,
  timeoutMs: number
): Promise<StopImageCredit | "nonFree" | null> {
  const found = fileOfThumbnail(thumbnailUrl);
  if (!found) return null;
  const { file, onCommons } = found;
  const fallback: StopImageCredit = {
    file,
    licence: null,
    licenceUrl: null,
    artist: null,
    sourceUrl: `https://${lang}.wikipedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, "_"))}`,
    onCommons,
  };
  if (timeoutMs <= 0) return fallback;
  const params = new URLSearchParams({
    action: "query",
    titles: `File:${file}`,
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    format: "json",
  });
  const outcome = await fetchOpenData(
    "wikipedia",
    `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`,
    { timeoutMs }
  );
  if (!outcome.ok) return fallback;
  const parsed = imageinfoSchema.safeParse(outcome.body);
  const info = parsed.success
    ? Object.values(parsed.data.query.pages)[0]?.imageinfo?.[0]
    : undefined;
  if (!info) return fallback;
  const meta = info.extmetadata ?? {};
  if (String(meta.NonFree?.value ?? "").toLowerCase() === "true") return "nonFree";
  return {
    ...fallback,
    licence: plainText(meta.LicenseShortName?.value) ?? capped(meta.License?.value),
    licenceUrl: capped(meta.LicenseUrl?.value),
    artist: plainText(meta.Artist?.value),
    sourceUrl: info.descriptionurl ?? fallback.sourceUrl,
  };
}
