import type { JourneyDomain } from "./journeyTypes";

/**
 * Where a journey operator's logo comes from. Rental companies have their own
 * endpoint (`rentalProviderLogoUrl`); for rail operators, coach companies,
 * ferry lines and a trip's airlines there is no source yet, so the card's
 * operator mark is the monogram on the domain colour.
 */
export function operatorLogoUrl(_domain: JourneyDomain, _name: string): string | null {
  return null;
}
