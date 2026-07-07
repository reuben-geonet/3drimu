export interface MarkerZoomOptions {
  baseScale: number;
  distance: number;
  minDistance: number;
  referenceDistance: number;
}

export interface MarkerZoomStyle {
  effectOpacityMultiplier: number;
  groupScale: number;
  projectedScaleRatio: number;
  worldScaleMultiplier: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ProjectedMarkerCandidate<T> {
  item: T;
  screenX: number;
  screenY: number;
  ndcX: number;
  ndcY: number;
  ndcZ: number;
}

export const MARKER_AND_LINK_ZOOM_SCALE = {
  // Set to false to restore the original fixed-world-size behavior.
  enabled: true,

  // Scaling starts once the camera is closer than this fraction of the default
  // view distance. Lower values delay shrinkage; higher values start sooner.
  startDistanceRatio: 0.72,

  // Projected marker/link-packet size at closest zoom, relative to default view.
  // Higher values keep things larger; lower values reduce dense-cluster clutter.
  minProjectedScaleRatio: 1.92,

  // Decorative beam/ring/link-packet opacity at closest zoom.
  // Higher values keep effects brighter; lower values reduce close-zoom clutter.
  minEffectOpacityMultiplier: 0.82
} as const;

export function getMarkerZoomStyle(options: MarkerZoomOptions): MarkerZoomStyle {
  const { baseScale, distance, minDistance, referenceDistance } = options;
  const config = MARKER_AND_LINK_ZOOM_SCALE;

  if (
    !config.enabled ||
    !Number.isFinite(distance) ||
    !Number.isFinite(minDistance) ||
    !Number.isFinite(referenceDistance) ||
    referenceDistance <= minDistance ||
    config.startDistanceRatio <= 0
  ) {
    return getFixedZoomStyle(baseScale, distance, referenceDistance);
  }

  const startDistance = Math.max(
    minDistance,
    Math.min(referenceDistance, referenceDistance * config.startDistanceRatio)
  );

  if (startDistance <= minDistance) {
    return getFixedZoomStyle(baseScale, distance, referenceDistance);
  }

  if (distance >= startDistance) {
    return getFixedZoomStyle(baseScale, distance, referenceDistance);
  }

  const clampedDistance = clamp(distance, minDistance, startDistance);
  const progress =
    (clampedDistance - minDistance) / (startDistance - minDistance);
  const eased = smoothstep(progress);
  const startProjectedScaleRatio = referenceDistance / startDistance;
  const projectedScaleRatio = lerp(
    config.minProjectedScaleRatio,
    startProjectedScaleRatio,
    eased
  );
  const worldScaleMultiplier =
    (clampedDistance / referenceDistance) * projectedScaleRatio;

  return {
    effectOpacityMultiplier: lerp(
      config.minEffectOpacityMultiplier,
      1,
      eased
    ),
    groupScale: baseScale * worldScaleMultiplier,
    projectedScaleRatio,
    worldScaleMultiplier
  };
}

export function pickNearestProjectedMarker<T>(
  point: ScreenPoint,
  candidates: readonly ProjectedMarkerCandidate<T>[],
  radiusPx: number
): T | null {
  const maxDistanceSq = radiusPx * radiusPx;
  let nearest: T | null = null;
  let nearestDistanceSq = maxDistanceSq;

  for (const candidate of candidates) {
    if (!isCandidatePickable(candidate)) {
      continue;
    }

    const distanceSq =
      (candidate.screenX - point.x) ** 2 + (candidate.screenY - point.y) ** 2;

    if (distanceSq <= nearestDistanceSq) {
      nearest = candidate.item;
      nearestDistanceSq = distanceSq;
    }
  }

  return nearest;
}

function isCandidatePickable<T>(
  candidate: ProjectedMarkerCandidate<T>
): boolean {
  return (
    Number.isFinite(candidate.screenX) &&
    Number.isFinite(candidate.screenY) &&
    Number.isFinite(candidate.ndcX) &&
    Number.isFinite(candidate.ndcY) &&
    Number.isFinite(candidate.ndcZ) &&
    Math.abs(candidate.ndcX) <= 1 &&
    Math.abs(candidate.ndcY) <= 1 &&
    candidate.ndcZ >= -1 &&
    candidate.ndcZ <= 1
  );
}

function getFixedZoomStyle(
  baseScale: number,
  distance: number,
  referenceDistance: number
): MarkerZoomStyle {
  const projectedScaleRatio =
    Number.isFinite(distance) && distance > 0 && Number.isFinite(referenceDistance)
      ? referenceDistance / distance
      : 1;

  return {
    effectOpacityMultiplier: 1,
    groupScale: baseScale,
    projectedScaleRatio,
    worldScaleMultiplier: 1
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}
