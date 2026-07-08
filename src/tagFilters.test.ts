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
      { tag: "mains12", visibleCount: 2, totalCount: 2, label: "mains12 2/2" },
      { tag: "building", visibleCount: 1, totalCount: 1, label: "building 1/1" },
      { tag: "gnss", visibleCount: 1, totalCount: 1, label: "gnss 1/1" },
      { tag: "seismic", visibleCount: 1, totalCount: 1, label: "seismic 1/1" }
    ]);
  });

  it("counts visible sites separately from total sites", () => {
    expect(
      buildSiteTagOptions(
        [
          { tags: ["gnss"], visible: true },
          { tags: ["gnss"], visible: false }
        ],
        (site) => site.visible
      )
    ).toEqual([
      { tag: "gnss", visibleCount: 1, totalCount: 2, label: "gnss 1/2" }
    ]);
  });

  it("skips empty tags", () => {
    expect(buildSiteTagOptions([{ tags: ["", "gnss"] }])).toEqual([
      { tag: "gnss", visibleCount: 1, totalCount: 1, label: "gnss 1/1" }
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
      { tag: "gnss.rt", visibleCount: 1, totalCount: 1, label: "gnss.rt 1/1" }
    ]);
  });
});
