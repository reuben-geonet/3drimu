import { computeLocalityStatus } from "./status";
import type {
  FaultsResponse,
  LinkArc,
  MapData,
  RimuGeoJson,
  RimuLineFeature,
  RimuPointFeature,
  SiteMarker
} from "./types";

const RIMU_BASE_URL = "https://rimu.geonet.org.nz";
const LOCALITIES_URL = `${RIMU_BASE_URL}/dapper/meta/fdmp/entries?aggregate=locality`;
const FAULTS_URL = `${RIMU_BASE_URL}/faults`;

const FALLBACK_GEOJSON: RimuGeoJson = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [176.24625, -40.67965] },
      properties: {
        key: "locality:birchfarm",
        locality: "birchfarm",
        tags: ["seismic", "gnss", "mains12"]
      }
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [174.7816, -41.29044] },
      properties: {
        key: "locality:tepapagps",
        locality: "tepapagps",
        sitecode: "WGTT",
        tags: ["gnss", "linz", "mains12"]
      }
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [172.58276, -43.52386] },
      properties: {
        key: "locality:ucjameshight",
        locality: "ucjameshight",
        sitecode: "CJHB",
        tags: ["building", "timing"]
      }
    }
  ]
};

const FALLBACK_FAULTS: FaultsResponse = {
  birchfarm: [
    {
      Key: "seismic-birchfarm",
      Locality: "birchfarm",
      Metrics: {
        packet_loss: {
          Field: "packet_loss",
          Timestamp: Date.now() / 1000,
          Status: 3
        }
      },
      Tags: ["seismic"]
    }
  ],
  tepapagps: [
    {
      Key: "gps-tepapagps",
      Locality: "tepapagps",
      Metrics: {
        satellites: {
          Field: "satellites",
          Timestamp: Date.now() / 1000,
          Status: 1
        }
      },
      Tags: ["gnss"]
    }
  ]
};

export async function loadRimuMapData(): Promise<MapData> {
  try {
    const [localities, faults] = await Promise.all([
      fetchJson<RimuGeoJson>(LOCALITIES_URL, {
        headers: { Accept: "application/geo+json" }
      }),
      fetchJson<FaultsResponse>(FAULTS_URL, {
        headers: { Accept: "application/json" }
      })
    ]);

    return {
      ...buildMapData(localities, faults),
      loadedFromLiveApi: true
    };
  } catch (error) {
    console.warn("Using fallback RIMU sample data", error);
    return {
      ...buildMapData(FALLBACK_GEOJSON, FALLBACK_FAULTS),
      loadedFromLiveApi: false
    };
  }
}

export function buildMapData(
  localities: RimuGeoJson,
  faults: FaultsResponse
): Omit<MapData, "loadedFromLiveApi"> {
  const sites: SiteMarker[] = [];
  const links: LinkArc[] = [];

  for (const feature of localities.features) {
    if (feature.geometry.type === "Point") {
      const pointFeature = feature as RimuPointFeature;
      const [lng, lat] = pointFeature.geometry.coordinates;
      const locality = pointFeature.properties.locality;

      if (!locality || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        continue;
      }

      const devices = faults[locality] ?? [];
      const { status, fieldStatus } = computeLocalityStatus(devices);

      sites.push({
        id: pointFeature.properties.key ?? `locality:${locality}`,
        locality,
        sitecode: pointFeature.properties.sitecode,
        lat,
        lng,
        tags: pointFeature.properties.tags ?? [],
        status,
        fieldStatus,
        devices
      });
    }

    if (feature.geometry.type === "LineString") {
      const lineFeature = feature as RimuLineFeature;
      const [start, end] = lineFeature.geometry.coordinates;

      if (!start || !end) {
        continue;
      }

      links.push({
        id: `${lineFeature.properties.fromKey ?? "from"}-${
          lineFeature.properties.toKey ?? "to"
        }-${links.length}`,
        fromKey: lineFeature.properties.fromKey,
        toKey: lineFeature.properties.toKey,
        type: lineFeature.properties.type ?? "link",
        startLng: start[0],
        startLat: start[1],
        endLng: end[0],
        endLat: end[1]
      });
    }
  }

  return {
    sites,
    links
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }

  return (await response.json()) as T;
}
