import { describe, expect, it } from "vitest";
import { buildDemoRoute, formatMetricLabel } from "./demo";

describe("formatMetricLabel", () => {
  it("formats raw metric fields for display", () => {
    expect(formatMetricLabel("packet_loss")).toBe("Packet Loss");
    expect(formatMetricLabel("gps-clock")).toBe("Gps Clock");
    expect(formatMetricLabel("batteryVoltage")).toBe("Battery Voltage");
    expect(formatMetricLabel("")).toBe("Metric");
  });
});

describe("buildDemoRoute", () => {
  it("includes every visible site once before any repeat", () => {
    const sites = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const route = buildDemoRoute(sites, null, () => 0);

    expect(route).toHaveLength(3);
    expect(new Set(route.map((site) => site.id))).toEqual(new Set(["a", "b", "c"]));
  });

  it("avoids immediately repeating the previous site when possible", () => {
    const route = buildDemoRoute(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      "c",
      () => 0
    );

    expect(route[0]?.id).not.toBe("c");
  });
});
