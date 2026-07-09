import { describe, expect, it } from "vitest";
import {
  getCameraFeedsForLocality,
  getLatestCameraImageUrl,
  getPrimaryCameraForVolcano
} from "./volcanoCameras";

describe("volcano camera mappings", () => {
  it("maps RIMU localities to configured GeoNet camera feeds", () => {
    const feeds = getCameraFeedsForLocality("discoverylodge");

    expect(feeds.map((feed) => feed.id)).toEqual([
      "ruapehunorth",
      "ngauruhoe"
    ]);
  });

  it("selects primary volcano cameras and leaves unmapped volcanoes empty", () => {
    expect(getPrimaryCameraForVolcano("ruapehu")?.id).toBe("ruapehunorth");
    expect(getPrimaryCameraForVolcano("taupo")).toBeNull();
  });

  it("builds latest image URLs for camera feeds", () => {
    const feed = getPrimaryCameraForVolcano("whiteisland");

    expect(feed).not.toBeNull();
    expect(getLatestCameraImageUrl(feed!)).toBe(
      "https://images.geonet.org.nz/volcano/cameras/latest/m-tekaha.jpg"
    );
  });
});
