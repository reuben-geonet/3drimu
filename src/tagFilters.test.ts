import { describe, expect, it } from "vitest";
import { buildSiteTagOptions, filterSiteTagOptions } from "./tagFilters";

describe("buildSiteTagOptions", () => {
  it("counts unique site tags and sorts by count then tag", () => {
    expect(
      buildSiteTagOptions([
        { tags: ["gnss", "mains12", "gnss"] },
        { tags: ["seismic", "mains12"] },
        { tags: ["building"] }
      ])
    ).toEqual([
      { tag: "mains12", count: 2, label: "mains12 2" },
      { tag: "building", count: 1, label: "building 1" },
      { tag: "gnss", count: 1, label: "gnss 1" },
      { tag: "seismic", count: 1, label: "seismic 1" }
    ]);
  });

  it("skips empty tags", () => {
    expect(buildSiteTagOptions([{ tags: ["", "gnss"] }])).toEqual([
      { tag: "gnss", count: 1, label: "gnss 1" }
    ]);
  });
});

describe("filterSiteTagOptions", () => {
  it("matches tag searches case-insensitively", () => {
    const options = buildSiteTagOptions([
      { tags: ["gnss.rt"] },
      { tags: ["seismic"] },
      { tags: ["strong"] }
    ]);

    expect(filterSiteTagOptions(options, "GNS")).toEqual([
      { tag: "gnss.rt", count: 1, label: "gnss.rt 1" }
    ]);
  });
});
