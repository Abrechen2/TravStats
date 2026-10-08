import type { Lodging, LodgingChain, LodgingType } from "../../types/lodging";

/**
 * The lodging form's draft as plain data — what the dirty guard compares and
 * what the field rules read. Its own module so the rules are testable without
 * rendering the form, and so `LodgingFormModal` stays a component.
 */
export interface LodgingFormFields {
  type: LodgingType;
  chain: LodgingChain | null;
  name: string;
  address: string;
  city: string;
  country: string;
  lat: number | null;
  lon: number | null;
  osmRef: string | null;
  stars: string;
  amenities: string[];
  notes: string;
  website: string;
}

/** What the form starts with: the stored lodging, or an empty hotel. */
export function lodgingFormFields(lodging: Lodging | null | undefined): LodgingFormFields {
  return {
    type: lodging?.type ?? "hotel",
    chain: lodging?.chain ?? null,
    name: lodging?.name ?? "",
    address: lodging?.address ?? "",
    city: lodging?.city ?? "",
    country: lodging?.country ?? "",
    lat: lodging?.lat ?? null,
    lon: lodging?.lon ?? null,
    osmRef: null,
    stars: lodging?.stars?.toString() ?? "",
    amenities: lodging?.amenities ?? [],
    notes: lodging?.notes ?? "",
    website: lodging?.website ?? "",
  };
}

/**
 * The comparable form of a draft. The chain is reduced to its id: the picker
 * hands back its own copy of a chain object, and a re-pick of the same chain
 * is no change.
 */
export function lodgingFormSnapshot(
  fields: LodgingFormFields
): Omit<LodgingFormFields, "chain"> & { chainId: number | null } {
  const { chain, ...rest } = fields;
  return { ...rest, chainId: chain?.id ?? null };
}

export type LodgingFieldErrors = Partial<Record<"stars" | "website", string>>;

/**
 * The two field rules the server would otherwise refuse with one generic
 * sentence (`backend/src/schemas/lodging.ts`): stars are a whole number from
 * 1 to 5, a website is an http(s) address. Empty is fine for both — it clears
 * the value. Returns translation KEYS, so the rule needs no `t`.
 */
export function lodgingFieldErrors({
  stars,
  website,
}: {
  stars: string;
  website: string;
}): LodgingFieldErrors {
  const errors: LodgingFieldErrors = {};
  const starsText = stars.trim();
  if (starsText !== "") {
    const value = Number(starsText);
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      errors.stars = "lodging:form.errors.stars";
    }
  }
  const websiteText = website.trim();
  if (websiteText !== "" && !isHttpUrl(websiteText)) {
    errors.website = "lodging:form.errors.website";
  }
  return errors;
}

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
