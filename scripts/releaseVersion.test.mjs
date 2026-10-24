import { describe, expect, it } from "vitest";
import { selectReleaseBaseline, validateReleaseVersion } from "./releaseVersion.mjs";

describe("selectReleaseBaseline", () => {
  it("uses the highest stable tag or package version", () => {
    expect(
      selectReleaseBaseline(
        ["0.2.8", "0.2.55", "0.2.56-rc.1", "0.2.100+build", "0.2.54"],
        "0.2.32",
      ),
    ).toBe("0.2.55");
  });

  it("keeps a package version newer than all tags as the baseline", () => {
    expect(selectReleaseBaseline(["0.2.55", "0.2.9"], "0.3.0")).toBe("0.3.0");
  });
});

describe("validateReleaseVersion", () => {
  it("rejects existing prerelease tags and stable version downgrades", () => {
    expect(() => validateReleaseVersion("0.3.0-rc.1", ["0.3.0-rc.1"], "0.2.56")).toThrow(/already exists/);
    expect(() => validateReleaseVersion("0.2.55", ["0.2.56"], "0.2.40")).toThrow(/must be newer/);
    expect(() => validateReleaseVersion("0.2.56-rc.1", ["0.2.56"], "0.2.40")).toThrow(/must be newer/);
  });

  it("allows prerelease progression and promotion to a stable release", () => {
    expect(() => validateReleaseVersion("0.3.0-rc.10", ["0.2.56"], "0.3.0-rc.2")).not.toThrow();
    expect(() => validateReleaseVersion("0.3.0", ["0.2.56"], "0.3.0-rc.2")).not.toThrow();
    expect(() => validateReleaseVersion("0.3.0-rc.1", ["0.3.0"], "0.2.56")).toThrow(/must be newer/);
  });
});
