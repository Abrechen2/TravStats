import { describe, it, expect } from "vitest";

import deCommon from "../resources/de/common.json";
import enCommon from "../resources/en/common.json";
import deSettings from "../resources/de/settings.json";
import enSettings from "../resources/en/settings.json";

/**
 * forgejo#88 P12, re-measured in the beta audit of 2026-09-19: the user menu
 * offered "Stern", and the About card "Stern auf GitHub". A star is a thing
 * GitHub users do to a repository; to everyone else it is a word with no
 * referent, sitting between "Spenden" and "Discord" as if it were one of them.
 *
 * The rule is not which words the label uses — it is that the label must say
 * what the link opens. So this asserts the ABSENCE of the internal vocabulary,
 * not the presence of one particular sentence, and that both languages name
 * the destination.
 */
const LABELS: readonly [string, string][] = [
  ["de common:support.star", deCommon.support.star],
  ["en common:support.star", enCommon.support.star],
  ["de common:support.starAria", deCommon.support.starAria],
  ["en common:support.starAria", enCommon.support.starAria],
  ["de settings:about.star", deSettings.about.star],
  ["en settings:about.star", enSettings.about.star],
];

describe("the GitHub link says where it goes", () => {
  it.each(LABELS)("%s does not borrow GitHub's 'star' vocabulary", (_name, label) => {
    expect(label.toLowerCase()).not.toMatch(/\bstern\b|\bsterne\b|\bstar\b/);
  });

  it.each(LABELS)("%s names GitHub", (_name, label) => {
    expect(label).toMatch(/GitHub/);
  });
});
