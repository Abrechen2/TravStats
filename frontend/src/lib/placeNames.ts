/**
 * A place's line under its name where only text fits (forgejo#199): the name
 * on the sign first, then where it is — "서울역 · Seoul, South Korea". Either
 * half may be missing; an empty string means there is nothing to show.
 */
export function placeSubtitle(place: {
  localName?: string | null;
  city: string | null;
  country: string | null;
}): string {
  const where = [place.city, place.country].filter(Boolean).join(", ");
  return [place.localName, where].filter(Boolean).join(" · ");
}
