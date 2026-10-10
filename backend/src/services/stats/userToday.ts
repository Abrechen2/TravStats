import { profileZoneOf } from "../../shared/time/profileZone";
import { todayIn } from "../../shared/time/clock";

/** Today (`YYYY-MM-DD`) in the user's profile zone — the time model's "today" (D4). */
export async function userToday(userId: string): Promise<string> {
  return todayIn((await profileZoneOf(userId)).zone);
}
