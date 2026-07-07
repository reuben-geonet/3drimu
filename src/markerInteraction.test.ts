import { describe, expect, it } from "vitest";
import {
  getMarkerZoomStyle,
  MARKER_AND_LINK_ZOOM_SCALE,
  pickNearestProjectedMarker,
  type ProjectedMarkerCandidate
} from "./markerInteraction";

const BASE_SCALE = 0.25;
const MIN_DISTANCE = 4.5;
const REFERENCE_DISTANCE = 35;

describe("getMarkerZoomStyle", () => {
  it("keeps the existing marker scale at the default camera distance", () => {
    const style = getMarkerZoomStyle({
      baseScale: BASE_SCALE,
      distance: REFERENCE_DISTANCE,
      minDistance: MIN_DISTANCE,
      referenceDistance: REFERENCE_DISTANCE
    });

    expect(style.groupScale).toBe(BASE_SCALE);
    expect(style.projectedScaleRatio).toBe(1);
    expect(style.effectOpacityMultiplier).toBe(1);
    expect(style.worldScaleMultiplier).toBe(1);
  });

  it("keeps markers readable at the closest zoom", () => {
    const style = getMarkerZoomStyle({
      baseScale: BASE_SCALE,
      distance: MIN_DISTANCE,
      minDistance: MIN_DISTANCE,
      referenceDistance: REFERENCE_DISTANCE
    });
    const defaultProjectedScale = BASE_SCALE / REFERENCE_DISTANCE;
    const minProjectedScale = style.groupScale / MIN_DISTANCE;

    expect(minProjectedScale / defaultProjectedScale).toBeCloseTo(
      MARKER_AND_LINK_ZOOM_SCALE.minProjectedScaleRatio
    );
    expect(style.effectOpacityMultiplier).toBeCloseTo(0.82);
  });

  it("does not shrink before the configured start distance", () => {
    const startDistance =
      REFERENCE_DISTANCE * MARKER_AND_LINK_ZOOM_SCALE.startDistanceRatio;
    const style = getMarkerZoomStyle({
      baseScale: BASE_SCALE,
      distance: startDistance,
      minDistance: MIN_DISTANCE,
      referenceDistance: REFERENCE_DISTANCE
    });

    expect(style.groupScale).toBe(BASE_SCALE);
    expect(style.worldScaleMultiplier).toBe(1);
  });

  it("clamps distances below the closest zoom to the closest zoom style", () => {
    const atMin = getMarkerZoomStyle({
      baseScale: BASE_SCALE,
      distance: MIN_DISTANCE,
      minDistance: MIN_DISTANCE,
      referenceDistance: REFERENCE_DISTANCE
    });
    const belowMin = getMarkerZoomStyle({
      baseScale: BASE_SCALE,
      distance: MIN_DISTANCE / 2,
      minDistance: MIN_DISTANCE,
      referenceDistance: REFERENCE_DISTANCE
    });

    expect(belowMin).toEqual(atMin);
  });

  it("does not enlarge markers when the camera is beyond the default distance", () => {
    const style = getMarkerZoomStyle({
      baseScale: BASE_SCALE,
      distance: REFERENCE_DISTANCE * 2,
      minDistance: MIN_DISTANCE,
      referenceDistance: REFERENCE_DISTANCE
    });

    expect(style.groupScale).toBe(BASE_SCALE);
    expect(style.worldScaleMultiplier).toBe(1);
  });

  it("shrinks monotonically as the camera moves closer", () => {
    const near = getMarkerZoomStyle({
      baseScale: BASE_SCALE,
      distance: 8,
      minDistance: MIN_DISTANCE,
      referenceDistance: REFERENCE_DISTANCE
    });
    const mid = getMarkerZoomStyle({
      baseScale: BASE_SCALE,
      distance: 18,
      minDistance: MIN_DISTANCE,
      referenceDistance: REFERENCE_DISTANCE
    });
    const far = getMarkerZoomStyle({
      baseScale: BASE_SCALE,
      distance: 28,
      minDistance: MIN_DISTANCE,
      referenceDistance: REFERENCE_DISTANCE
    });

    expect(near.groupScale).toBeLessThan(mid.groupScale);
    expect(mid.groupScale).toBeLessThan(far.groupScale);
    expect(near.worldScaleMultiplier).toBeLessThan(mid.worldScaleMultiplier);
    expect(mid.worldScaleMultiplier).toBeLessThan(far.worldScaleMultiplier);
  });
});

describe("pickNearestProjectedMarker", () => {
  it("selects the nearest visible marker inside the pick radius", () => {
    const candidates: ProjectedMarkerCandidate<string>[] = [
      candidate("far", 108, 100),
      candidate("near", 102, 100)
    ];

    expect(pickNearestProjectedMarker({ x: 100, y: 100 }, candidates, 18)).toBe(
      "near"
    );
  });

  it("returns null when no marker is inside the pick radius", () => {
    const candidates = [candidate("site", 140, 100)];

    expect(
      pickNearestProjectedMarker({ x: 100, y: 100 }, candidates, 18)
    ).toBeNull();
  });

  it("ignores invalid and offscreen projected markers", () => {
    const candidates: ProjectedMarkerCandidate<string>[] = [
      candidate("invalid", Number.NaN, 100),
      candidate("offscreen-x", 100, 100, { ndcX: 1.1 }),
      candidate("behind", 100, 100, { ndcZ: 1.1 }),
      candidate("visible", 104, 100)
    ];

    expect(pickNearestProjectedMarker({ x: 100, y: 100 }, candidates, 18)).toBe(
      "visible"
    );
  });
});

function candidate(
  item: string,
  screenX: number,
  screenY: number,
  overrides: Partial<ProjectedMarkerCandidate<string>> = {}
): ProjectedMarkerCandidate<string> {
  return {
    item,
    screenX,
    screenY,
    ndcX: 0,
    ndcY: 0,
    ndcZ: 0,
    ...overrides
  };
}
