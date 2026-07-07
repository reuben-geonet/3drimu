import type { Feature, FeatureCollection, LineString, Point } from "geojson";

export type RimuStatus =
  | "ok"
  | "warning"
  | "bad"
  | "unknown"
  | "acknowledged"
  | "overdue";

export type NumericRimuStatus = 1 | 2 | 3 | 4 | 5 | 6;

export interface RimuMetric {
  Field: string;
  Timestamp: number;
  Status: NumericRimuStatus;
  Acknowledged?: number;
}

export interface RimuFaultDevice {
  Key: string;
  Locality: string;
  Metrics?: Record<string, RimuMetric>;
  Tags?: string[];
  Acknowledged?: number;
  LastUpdated?: number;
}

export type FaultsResponse = Record<string, RimuFaultDevice[]>;

export interface RimuFeatureProperties {
  domain?: string;
  key?: string;
  locality?: string;
  sitecode?: string;
  tags?: string[];
  fromKey?: string;
  toKey?: string;
  type?: string;
}

export type RimuPointFeature = Feature<Point, RimuFeatureProperties>;
export type RimuLineFeature = Feature<LineString, RimuFeatureProperties>;
export type RimuGeoJson = FeatureCollection<Point | LineString, RimuFeatureProperties>;

export interface SiteMarker {
  id: string;
  locality: string;
  sitecode?: string;
  lat: number;
  lng: number;
  tags: string[];
  status: RimuStatus;
  fieldStatus: Record<string, RimuStatus>;
  devices: RimuFaultDevice[];
}

export interface LinkArc {
  id: string;
  fromKey?: string;
  toKey?: string;
  type: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}

export interface MapData {
  sites: SiteMarker[];
  links: LinkArc[];
  loadedFromLiveApi: boolean;
}
