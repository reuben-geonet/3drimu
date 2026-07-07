import { expect, test, type Page } from "@playwright/test";

const geoJsonFixture = {
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
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [176.24625, -40.67965],
          [174.7816, -41.29044]
        ]
      },
      properties: {
        fromKey: "locality:birchfarm",
        toKey: "locality:tepapagps",
        type: "5G"
      }
    }
  ]
};

const faultsFixture = {
  birchfarm: [
    {
      Key: "seismic-birchfarm",
      Locality: "birchfarm",
      Metrics: {
        packet_loss: {
          Field: "packet_loss",
          Timestamp: 1783386033,
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
          Timestamp: 1783386033,
          Status: 1
        }
      },
      Tags: ["gnss"]
    }
  ],
  ucjameshight: [
    {
      Key: "building-ucjameshight",
      Locality: "ucjameshight",
      Metrics: {
        clock: {
          Field: "clock",
          Timestamp: 1783386033,
          Status: 2
        }
      },
      Tags: ["building"]
    }
  ]
};

test.beforeEach(async ({ page }) => {
  await mockRimuApi(page);
});

test("loads the close extruded map view, keeps loading visible, and renders markers", async ({
  page
}) => {
  await page.goto("/");

  const loading = page.getByTestId("loading-overlay");
  await expect(loading).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(loading).toBeVisible();
  await expect(loading).toBeHidden({ timeout: 9000 });

  await page.waitForFunction(() => window.__RIMU_MAP_READY__ === true);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator(".brand-lockup")).toHaveCount(0);
  await expect(page.locator("#data-summary")).toHaveCount(0);
  await expect(page.locator(".control-button .tabler-icon")).toHaveCount(3);

  const siteCount = await page.evaluate(() => window.__RIMU_SITE_COUNT__);
  expect(siteCount).toBe(3);
  await expect(page.locator("#legend .legend-button")).toHaveCount(6);

  const nonBlankCanvas = await page.locator("canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const gl =
      canvas.getContext("webgl2", { preserveDrawingBuffer: true }) ??
      canvas.getContext("webgl", { preserveDrawingBuffer: true });

    if (!gl) {
      return false;
    }

    const width = Math.min(48, canvas.width);
    const height = Math.min(48, canvas.height);
    const x = Math.max(0, Math.floor(canvas.width / 2 - width / 2));
    const y = Math.max(0, Math.floor(canvas.height / 2 - height / 2));
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let litPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 6 || pixels[index + 1] > 6 || pixels[index + 2] > 6) {
        litPixels++;
      }
    }

    return litPixels > 60;
  });

  expect(nonBlankCanvas).toBe(true);
});

test("toggles marker statuses from the top-left legend", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__RIMU_MAP_READY__ === true);

  const badToggle = page.locator('#legend .legend-button[data-status="bad"]');

  await expect(badToggle).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_VISIBLE_SITE_COUNT__))
    .toBe(3);

  await badToggle.click();

  await expect(badToggle).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_VISIBLE_SITE_COUNT__))
    .toBe(2);

  await badToggle.click();

  await expect(badToggle).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_VISIBLE_SITE_COUNT__))
    .toBe(3);
});

test("toggles and persists light mode", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__RIMU_MAP_READY__ === true);

  const initialTheme = await page.locator("html").getAttribute("data-theme");
  const expectedTheme = initialTheme === "dark" ? "light" : "dark";

  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", expectedTheme);

  await page.reload();
  await page.waitForFunction(() => window.__RIMU_MAP_READY__ === true);
  await expect(page.locator("html")).toHaveAttribute("data-theme", expectedTheme);
});

async function mockRimuApi(page: Page): Promise<void> {
  await page.route(/\/dapper\/meta\/fdmp\/entries\?aggregate=locality$/, (route) =>
    route.fulfill({
      contentType: "application/geo+json",
      body: JSON.stringify(geoJsonFixture)
    })
  );

  await page.route(/\/faults$/, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(faultsFixture)
    })
  );
}
