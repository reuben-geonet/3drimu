import { describe, expect, it } from "vitest";
import { getVolcanoLevelColor, parseVolcanoMarkers } from "./volcanoes";

describe("parseVolcanoMarkers", () => {
  it("parses GeoNet volcano alert GeoJSON into map markers", () => {
    const markers = parseVolcanoMarkers({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [175.563, -39.281] },
          properties: {
            acc: "Green",
            activity: "Minor volcanic unrest.",
            hazards: "Volcanic unrest hazards.",
            level: 1,
            volcanoID: "ruapehu",
            volcanoTitle: "Ruapehu"
          }
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [175.896, -38.784] },
          properties: {
            acc: "Green",
            activity: "No volcanic unrest.",
            hazards: "Volcanic environment hazards.",
            level: 0,
            volcanoID: "taupo",
            volcanoTitle: "Taupo"
          }
        }
      ]
    });

    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({
      id: "ruapehu",
      title: "Ruapehu",
      level: 1,
      cameraFeed: expect.objectContaining({ id: "ruapehunorth" })
    });
    expect(markers[1]).toMatchObject({
      id: "taupo",
      title: "Taupo",
      level: 0,
      cameraFeed: null
    });
  });

  it("normalizes Whakaari naming and skips malformed features", () => {
    const markers = parseVolcanoMarkers({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [177.183, -37.521] },
          properties: {
            acc: "Yellow",
            activity: "Moderate to heightened volcanic unrest.",
            hazards: "Volcanic unrest hazards.",
            level: 2,
            volcanoID: "whiteisland",
            volcanoTitle: "White Island"
          }
        },
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [] },
          properties: {
            level: 0,
            volcanoID: "missing",
            volcanoTitle: "Missing"
          }
        }
      ]
    });

    expect(markers).toHaveLength(1);
    expect(markers[0]?.title).toBe("Whakaari/White Island");
  });
});

describe("getVolcanoLevelColor", () => {
  it("returns GeoNet alert level colours", () => {
    expect(getVolcanoLevelColor(0)).toBe("#E7DEEC");
    expect(getVolcanoLevelColor(5)).toBe("#832C82");
  });
});
