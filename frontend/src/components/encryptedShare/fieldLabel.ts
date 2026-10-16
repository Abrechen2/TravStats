type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Label of a shared record column. `field.<name>` is the general wording;
 * `fieldByDomain.<domain>.<name>` holds a domain's own word where one column
 * name means different things — a flight's `departureTime` is "Abflug", a
 * train's "Abfahrt" — so the consent preview speaks each domain's language.
 */
export function comparisonFieldLabel(t: Translate, domain: string, name: string): string {
  return t(`encryptedShare:fieldByDomain.${domain}.${name}`, {
    defaultValue: t(`encryptedShare:field.${name}`),
  });
}
