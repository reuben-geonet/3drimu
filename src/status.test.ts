import { describe, expect, it } from "vitest";
import { buildMapData, getRimuChartUrl } from "./api";
import { computeLocalityStatus } from "./status";
import type { FaultsResponse, RimuGeoJson } from "./types";

describe("computeLocalityStatus", () => {
  it("marks unacknowledged bad metrics as bad", () => {
    const result = computeLocalityStatus([
      {
        Key: "seismic-test",
        Locality: "test",
        Metrics: {
          packet_loss: {
            Field: "packet_loss",
            Timestamp: 100,
            Status: 3
          }
        }
      }
    ]);

    expect(result.status).toBe("bad");
    expect(result.fieldStatus.packet_loss).toBe("bad");
  });

  it("marks old acknowledged alerts as overdue", () => {
    const now = 10_000_000;
    const result = computeLocalityStatus(
      [
        {
          Key: "gps-test",
          Locality: "test",
          Acknowledged: 1,
          Metrics: {
            voltage: {
              Field: "voltage",
              Timestamp: now,
              Status: 2
            }
          }
        }
      ],
      now
    );

    expect(result.status).toBe("overdue");
    expect(result.fieldStatus.voltage).toBe("overdue");
  });
});

describe("buildMapData", () => {
  it("turns RIMU GeoJSON points and line strings into render data", () => {
    const geoJson: RimuGeoJson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [174.78, -41.29] },
          properties: {
            key: "locality:wellington",
            locality: "wellington",
            sitecode: "WGTN",
            tags: ["strong"]
          }
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [174.78, -41.29],
              [176.24, -40.67]
            ]
          },
          properties: {
            fromKey: "locality:wellington",
            toKey: "locality:birchfarm",
            type: "5G"
          }
        }
      ]
    };
    const faults: FaultsResponse = {
      wellington: [
        {
          Key: "strong-wellington",
          Locality: "wellington",
          Metrics: {
            clock: {
              Field: "clock",
              Timestamp: 100,
              Status: 1
            }
          }
        }
      ]
    };

    const data = buildMapData(geoJson, faults);

    expect(data.sites).toHaveLength(1);
    expect(data.sites[0]?.status).toBe("ok");
    expect(data.links).toHaveLength(1);
    expect(data.links[0]?.type).toBe("5G");
  });
});

describe("getRimuChartUrl", () => {
  it("builds a RIMU chart URL for a locality", () => {
    expect(getRimuChartUrl("stoutstreet")).toBe(
      "https://rimu.geonet.org.nz/#/chart?location=stoutstreet"
    );
  });

  it("encodes locality values for the hash query", () => {
    expect(getRimuChartUrl("test site/a")).toBe(
      "https://rimu.geonet.org.nz/#/chart?location=test%20site%2Fa"
    );
  });
});
