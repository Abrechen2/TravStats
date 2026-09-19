/**
 * Moved to `shared/lodgingSpendConverted.ts` in task 7b-3, where the backend
 * mirror can state the same rule: the evidence resolver for
 * `lodgingSpendTotal` has to answer "is this a real total" exactly as the
 * tile does, and a rule with two homes is a rule that will one day disagree
 * with itself.
 *
 * Kept as a re-export rather than deleted so the two components that already
 * import it do not move in a commit about the backend.
 */
export {
  lodgingSpendNothingConverted,
  type LodgingSpendShape,
} from "../shared/lodgingSpendConverted";
