/**
 * A document has at most one link per entry, so the in-file links can never
 * exceed the entries of the file: 1 trip + flights, stays, cruises, rail, bus,
 * ferry (300 each, 20 cruises), rentals (50) and visits (2000). The cap equals
 * that sum, so no stored document can make an export fail its own validation.
 */
export const MAX_DOCUMENT_LINKS = 1 + 300 + 300 + 20 + 300 + 300 + 300 + 50 + 2000;
