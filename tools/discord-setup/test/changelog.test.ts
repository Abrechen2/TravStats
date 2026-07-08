import { describe, it, expect } from "vitest";
import { stripPrerelease, extractChangelogEntry } from "../src/changelog.js";

const SAMPLE = `# Changelog

## [2.3.0] - 2026-07-10

### Added
- Feature A
- Feature B

### Fixed
- Bug X

## [2.2.1] - 2026-07-03

### Fixed
- Old bug
`;

describe("stripPrerelease", () => {
  it("removes an -rc.N suffix", () => {
    expect(stripPrerelease("2.3.0-rc.1")).toBe("2.3.0");
  });
  it("removes a -beta.N suffix", () => {
    expect(stripPrerelease("2.3.0-beta.8")).toBe("2.3.0");
  });
  it("leaves a plain version untouched", () => {
    expect(stripPrerelease("2.3.0")).toBe("2.3.0");
  });
});

describe("extractChangelogEntry", () => {
  it("returns the body for a plain version up to the next heading", () => {
    const entry = extractChangelogEntry(SAMPLE, "2.3.0");
    expect(entry).toContain("Feature A");
    expect(entry).toContain("Bug X");
    expect(entry).not.toContain("Old bug"); // stops at 2.2.1
  });

  it("resolves an RC version to its base entry", () => {
    const entry = extractChangelogEntry(SAMPLE, "2.3.0-rc.1");
    expect(entry).toContain("Feature A");
  });

  it("does not confuse 2.2.1 with a hypothetical 2.2.10", () => {
    const cl = "## [2.2.10] - 2026-01-01\n- ten\n\n## [2.2.1] - 2026-01-02\n- one\n";
    expect(extractChangelogEntry(cl, "2.2.1")).toContain("one");
    expect(extractChangelogEntry(cl, "2.2.1")).not.toContain("ten");
  });

  it("returns null when the version has no entry", () => {
    expect(extractChangelogEntry(SAMPLE, "9.9.9")).toBeNull();
  });
});
