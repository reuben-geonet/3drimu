import type { VolcanoCameraFeed } from "./types";

const VOLCANO_CAMERA_BASE_URL =
  "https://images.geonet.org.nz/volcano/cameras";

export const VOLCANO_CAMERA_FEEDS: Record<string, VolcanoCameraFeed> = {
  ngauruhoe: feed("ngauruhoe", "Ngauruhoe from West", ["ngauruhoe"]),
  ngauruhoetongariro: feed(
    "ngauruhoetongariro",
    "Ngauruhoe & Tongariro from South East",
    ["ngauruhoe", "tongariro"]
  ),
  raoulisland: feed("raoulisland", "Raoul Island", ["kermadecislands"]),
  ruapehunorth: feed("ruapehunorth", "Ruapehu from North", ["ruapehu"]),
  ruapehueast: feed("ruapehueast", "Ruapehu from East", ["ruapehu"]),
  ruapehusouth: feed("ruapehusouth", "Ruapehu from South", ["ruapehu"]),
  taranaki: feed("taranaki", "Taranaki Maunga from New Plymouth", [
    "taranakiegmont"
  ]),
  tekaha: feed("tekaha", "Whakaari/White Island from Te Kaha", [
    "whiteisland"
  ]),
  whakatane: feed("whakatane", "Whakaari/White Island from Whakatane", [
    "whiteisland"
  ]),
  tongariro: feed("tongariro", "Tongariro from North", ["tongariro"]),
  tongarirotemaaricrater: feed(
    "tongarirotemaaricrater",
    "Tongariro Te Maari Crater",
    ["tongariro"]
  )
};

const SITE_CAMERA_IDS: Record<string, string[]> = {
  discoverylodge: ["ruapehunorth", "ngauruhoe"],
  taiping: ["ruapehueast", "ngauruhoetongariro"],
  raoulmountmoumoukai: ["raoulisland"],
  mangateitei: ["ruapehusouth"],
  taranakiemergencymanagement: ["taranaki"],
  tekaha: ["tekaha"],
  whakatanehub: ["whakatane"],
  kakaramea: ["tongariro"],
  karewarewa: ["tongarirotemaaricrater"]
};

const VOLCANO_CAMERA_IDS: Record<string, string> = {
  kermadecislands: "raoulisland",
  ngauruhoe: "ngauruhoe",
  ruapehu: "ruapehunorth",
  taranakiegmont: "taranaki",
  tongariro: "tongariro",
  whiteisland: "tekaha"
};

export function getCameraFeedsForLocality(locality: string): VolcanoCameraFeed[] {
  return (SITE_CAMERA_IDS[locality.toLowerCase()] ?? [])
    .map((cameraId) => VOLCANO_CAMERA_FEEDS[cameraId])
    .filter((feed): feed is VolcanoCameraFeed => feed !== undefined);
}

export function getPrimaryCameraForVolcano(
  volcanoId: string
): VolcanoCameraFeed | null {
  const cameraId = VOLCANO_CAMERA_IDS[volcanoId.toLowerCase()];

  return cameraId ? VOLCANO_CAMERA_FEEDS[cameraId] ?? null : null;
}

export function getLatestCameraImageUrl(
  feed: VolcanoCameraFeed,
  size: "thumb" | "medium" | "large" = "medium"
): string {
  if (size === "thumb") {
    return `${VOLCANO_CAMERA_BASE_URL}/${feed.latestImageThumb}`;
  }

  if (size === "large") {
    return `${VOLCANO_CAMERA_BASE_URL}/${feed.latestImageLarge}`;
  }

  return `${VOLCANO_CAMERA_BASE_URL}/${feed.latestImageMedium}`;
}

function feed(
  id: string,
  title: string,
  volcanoIds: string[]
): VolcanoCameraFeed {
  return {
    id,
    title,
    volcanoIds,
    latestImageMedium: `latest/m-${id}.jpg`,
    latestImageThumb: `latest/t-${id}.jpg`,
    latestImageLarge: `latest/${id}.jpg`
  };
}
