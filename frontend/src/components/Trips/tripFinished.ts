/** True when the trip's last day (`YYYY-MM-DD…`) is before `today` in the profile zone. */
export function isTripFinished(endDate: string | null, today: string): boolean {
  return endDate !== null && endDate.slice(0, 10) < today;
}
