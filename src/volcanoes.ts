import type {
  VolcanoMarker,
  VolcanicAlertLevel,
  VolcanoCameraFeed
} from "./types";
import { getPrimaryCameraForVolcano } from "./volcanoCameras";

const GEONET_VOLCANO_VAL_URL = "https://api.geonet.org.nz/volcano/val";
const GEONET_VOLCANO_PAGE_BASE_URL = "https://www.geonet.org.nz/volcano";

export const VOLCANIC_ALERT_LEVELS: VolcanicAlertLevel[] = [0, 1, 2, 3, 4, 5];

export const VOLCANO_LEVEL_COLORS: Record<VolcanicAlertLevel, string> = {
  0: "#E7DEEC",
  1: "#DCC9E0",
  2: "#D1B5D3",
  3: "#A867A2",
  4: "#954990",
  5: "#832C82"
};

interface GeoNetVolcanoValResponse {
  type: "FeatureCollection";
  features?: GeoNetVolcanoFeature[];
}

interface GeoNetVolcanoFeature {
  type: "Feature";
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
  properties?: {
    acc?: unknown;
    activity?: unknown;
    hazards?: unknown;
    level?: unknown;
    volcanoID?: unknown;
    volcanoTitle?: unknown;
  };
}

export async function loadVolcanoMarkers(): Promise<VolcanoMarker[]> {
  try {
    const response = await fetch(GEONET_VOLCANO_VAL_URL, {
      headers: { Accept: "application/vnd.geo+json, application/json" }
    });

    if (!response.ok) {
      throw new Error(
        `${response.status} ${response.statusText} for ${GEONET_VOLCANO_VAL_URL}`
      );
    }

    return parseVolcanoMarkers(
      (await response.json()) as GeoNetVolcanoValResponse
    );
  } catch (error) {
    console.warn("Unable to load GeoNet volcano alert levels", error);
    return [];
  }
}

export function parseVolcanoMarkers(
  response: GeoNetVolcanoValResponse
): VolcanoMarker[] {
  const markers: VolcanoMarker[] = [];

  for (const feature of response.features ?? []) {
    const marker = parseVolcanoFeature(feature);

    if (marker) {
      markers.push(marker);
    }
  }

  return markers;
}

export function getVolcanoLevelColor(level: VolcanicAlertLevel): string {
  return VOLCANO_LEVEL_COLORS[level];
}

function parseVolcanoFeature(feature: GeoNetVolcanoFeature): VolcanoMarker | null {
  const coordinates = feature.geometry?.coordinates;
  const properties = feature.properties;

  if (
    feature.geometry?.type !== "Point" ||
    !Array.isArray(coordinates) ||
    coordinates.length < 2 ||
    !properties
  ) {
    return null;
  }

  const [lng, lat] = coordinates;
  const id = asNonEmptyString(properties.volcanoID);
  const title = asNonEmptyString(properties.volcanoTitle);
  const level = parseVolcanicAlertLevel(properties.level);

  if (
    !id ||
    !title ||
    level === null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }

  const cameraFeed: VolcanoCameraFeed | null = getPrimaryCameraForVolcano(id);

  return {
    id,
    title: normalizeVolcanoTitle(title),
    lat: Number(lat),
    lng: Number(lng),
    level,
    activity: asNonEmptyString(properties.activity) ?? "N/A",
    hazards: asNonEmptyString(properties.hazards) ?? "N/A",
    aviationColor: asNonEmptyString(properties.acc) ?? "N/A",
    url: `${GEONET_VOLCANO_PAGE_BASE_URL}/${id}`,
    cameraFeed
  };
}

function parseVolcanicAlertLevel(value: unknown): VolcanicAlertLevel | null {
  const level = Number(value);

  if (
    Number.isInteger(level) &&
    VOLCANIC_ALERT_LEVELS.includes(level as VolcanicAlertLevel)
  ) {
    return level as VolcanicAlertLevel;
  }

  return null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed === "" ? null : trimmed;
}

function normalizeVolcanoTitle(title: string): string {
  if (title === "White Island") {
    return "Whakaari/White Island";
  }

  return title;
}
