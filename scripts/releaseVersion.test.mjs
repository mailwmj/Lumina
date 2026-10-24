import { describe, expect, it } from "vitest";
import { selectReleaseBaseline } from "./releaseVersion.mjs";

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
