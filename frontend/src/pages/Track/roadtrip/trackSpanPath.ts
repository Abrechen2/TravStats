/** The Track page of a roadtrip's recorded days (rc46 extras A): one day, or a picked span. */
export function trackSpanPath(span: { fromDay: string; toDay: string }): string {
  return span.fromDay === span.toDay
    ? `/track/${span.toDay}`
    : `/track/${span.toDay}?range=custom&from=${span.fromDay}`;
}
