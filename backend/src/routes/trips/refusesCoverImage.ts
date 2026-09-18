import type { Response } from "express";
import { isSharedDemoUser } from "../../middleware/demoGuard";

/**
 * The shared demo account may not set a trip's cover image URL (independent
 * review, 2026-09-17, finding A6). It is not a preference but a pointer at an
 * arbitrary host: the image is then rendered on the trip for every LATER
 * visitor of a public instance, which is the harm the profile picture already
 * carries, plus one the profile picture does not — the owner of that URL
 * learns the IP of everybody who opens the trip. `/trips/:id/cover`, the
 * upload door to the same column, is refused already.
 *
 * Narrow on purpose: only this ONE field, on both write paths, and only for
 * the shared login. Everything else about a trip stays editable, because
 * keeping a journey is what a visitor came to try. `!== undefined` rather
 * than a truthiness test — clearing it is a change to the field too, and
 * collapsing the two would make the guard depend on the value.
 *
 * Returns true when it has already answered; the caller then returns.
 */
export async function refusesCoverImage(
  userId: string,
  coverImageUrl: string | null | undefined,
  res: Response
): Promise<boolean> {
  if (coverImageUrl === undefined) return false;
  if (!(await isSharedDemoUser(userId))) return false;
  res.status(403).json({
    error: "DEMO_ACCOUNT_FORBIDDEN",
    message: "The demo account cannot change this. Use your own account on your own instance.",
  });
  return true;
}
