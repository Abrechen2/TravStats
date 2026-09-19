import type { PhotoJourney } from "../../types/photoJourney";

/**
 * What accepting a finding will do — ONE rule, read by the card that PROMISES
 * it and by the code that DOES it.
 *
 * It was two: `acceptPhotoJourney` fell through to "answer only" for a `place`
 * finding whose place had been deleted since the scan, while the card went on
 * printing "records a visit to this place". Behaviour right, sentence wrong,
 * and nothing could have noticed, because the promise and the act were derived
 * in two files from two different conditions. Now they are derived here.
 *
 * The four outcomes, and why two of them create nothing:
 *
 * - `trip` — the row carries a span and a place name, which is a whole trip.
 * - `placeVisit` — the row carries an own place and a day, which is a visit.
 * - `stayAnswerOnly` — a `LodgingStay` hangs off a `Lodging`; a stay finding
 *   names an own *Place* ("the own place that gives the nights a name") and no
 *   lodging at all. Creating one would mean inventing the hotel, and recording
 *   a place visit instead would quietly create something other than what was
 *   offered.
 * - `placeMissingAnswerOnly` — a `place` finding whose `placeId` is gone. The
 *   FK cascades, so the row is normally deleted with the place; this is the
 *   window between a scan and a deletion. Answering it is still right,
 *   inventing a place is not.
 */
export type PhotoJourneyPlan = "trip" | "placeVisit" | "stayAnswerOnly" | "placeMissingAnswerOnly";

export function photoJourneyPlan(journey: PhotoJourney): PhotoJourneyPlan {
  if (journey.kind === "trip") return "trip";
  if (journey.kind === "stay") return "stayAnswerOnly";
  return journey.placeId ? "placeVisit" : "placeMissingAnswerOnly";
}
