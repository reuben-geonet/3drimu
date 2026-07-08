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

test("loads the close extruded map view and renders markers", async ({
  page
}) => {
  await page.goto("/");

  const loading = page.getByTestId("loading-overlay");
  await expect(loading).toBeVisible();
  await expect(loading).toContainText("Loading...");
  await expect(loading).not.toContainText("RIMU Map Link");
  await expect(loading).toBeHidden({ timeout: 9000 });

  await page.waitForFunction(() => window.__RIMU_MAP_READY__ === true);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator(".brand-lockup")).toHaveCount(0);
  await expect(page.locator("#data-summary")).toHaveCount(0);
  await expect(page.locator(".control-button .tabler-icon")).toHaveCount(7);

  const siteCount = await page.evaluate(() => window.__RIMU_SITE_COUNT__);
  expect(siteCount).toBe(3);
  await expect(page.locator("#legend .legend-button")).toHaveCount(6);
  await expect(page.getByTestId("tag-filter")).toBeVisible();

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

test("toggles radio links independently from marker statuses", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__RIMU_MAP_READY__ === true);

  const linksToggle = page.getByTestId("toggle-links");

  await expect(linksToggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => window.__RIMU_LINK_COUNT__)).toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_LINKS_VISIBLE__))
    .toBe(true);

  await linksToggle.click();

  await expect(linksToggle).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_LINKS_VISIBLE__))
    .toBe(false);
  await expect
    .poll(() => getSearchParam(page, "radioLink"))
    .toBe("false");

  await linksToggle.click();

  await expect(linksToggle).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_LINKS_VISIBLE__))
    .toBe(true);
  await expect
    .poll(() => getSearchParam(page, "radioLink"))
    .toBeNull();
});

test("toggles auto refresh and persists it in the URL", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__RIMU_MAP_READY__ === true);

  const autoRefreshToggle = page.getByTestId("auto-refresh");

  await expect(autoRefreshToggle).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_AUTO_REFRESH_ACTIVE__))
    .toBe(false);

  await autoRefreshToggle.click();

  await expect(autoRefreshToggle).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_AUTO_REFRESH_ACTIVE__))
    .toBe(true);
  await expect(autoRefreshToggle.locator(".control-label")).toContainText(
    /^Next 1[45]:[0-5]\d$/
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.__RIMU_AUTO_REFRESH_REMAINING_SECONDS__ ?? 0)
    )
    .toBeGreaterThan(890);
  await expect
    .poll(() => getSearchParam(page, "autoRefresh"))
    .toBe("true");

  await autoRefreshToggle.click();

  await expect(autoRefreshToggle).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_AUTO_REFRESH_ACTIVE__))
    .toBe(false);
  await expect(autoRefreshToggle.locator(".control-label")).toHaveText(
    "Auto Refresh"
  );
  await expect
    .poll(() => getSearchParam(page, "autoRefresh"))
    .toBeNull();
});

test("runs the TV demo loop across currently visible sites", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__RIMU_MAP_READY__ === true);

  const demoToggle = page.getByTestId("demo-mode");

  await expect(demoToggle).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_DEMO_ACTIVE__))
    .toBe(false);

  await demoToggle.click();

  await expect(demoToggle).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_DEMO_ACTIVE__))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_DEMO_ROUTE_SIZE__))
    .toBe(3);
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_DEMO_CURRENT_SITE__))
    .not.toBeNull();
  await expect
    .poll(() => getSearchParam(page, "demoMode"))
    .toBe("true");

  await demoToggle.click();

  await expect(demoToggle).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_DEMO_ACTIVE__))
    .toBe(false);
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_DEMO_ROUTE_SIZE__))
    .toBe(0);
  await expect
    .poll(() => getSearchParam(page, "demoMode"))
    .toBeNull();
});

test("toggles fullscreen mode from the toolbar", async ({ page }) => {
  await page.addInitScript(() => {
    let fullscreenElement: Element | null = null;

    Object.defineProperty(Document.prototype, "fullscreenEnabled", {
      configurable: true,
      get: () => true
    });
    Object.defineProperty(Document.prototype, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement
    });
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: function requestFullscreen(this: Element): Promise<void> {
        fullscreenElement = this;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      }
    });
    Object.defineProperty(Document.prototype, "exitFullscreen", {
      configurable: true,
      value: function exitFullscreen(): Promise<void> {
        fullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      }
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("loading-overlay")).toBeHidden({ timeout: 9000 });
  await page.waitForFunction(() => window.__RIMU_MAP_READY__ === true);

  const fullscreenToggle = page.getByTestId("fullscreen-toggle");
  await expect(fullscreenToggle).toBeVisible();

  await expect(fullscreenToggle).toHaveAttribute("aria-pressed", "false");
  await expect(fullscreenToggle).toHaveAttribute("aria-label", "Enter fullscreen");

  await fullscreenToggle.click();

  await expect
    .poll(() => page.evaluate(() => window.__RIMU_FULLSCREEN_ACTIVE__))
    .toBe(true);
  await expect(fullscreenToggle).toHaveAttribute("aria-pressed", "true");
  await expect(fullscreenToggle).toHaveAttribute("aria-label", "Exit fullscreen");

  await fullscreenToggle.click();

  await expect
    .poll(() => page.evaluate(() => window.__RIMU_FULLSCREEN_ACTIVE__))
    .toBe(false);
  await expect(fullscreenToggle).toHaveAttribute("aria-pressed", "false");
  await expect(fullscreenToggle).toHaveAttribute("aria-label", "Enter fullscreen");
});

test("loads toggle visibility and filters from query parameters", async ({
  page
}) => {
  await page.goto(
    "/?autoRefresh=true&demoMode=true&radioLink=false&filters=ok,warning"
  );
  await page.waitForFunction(() => window.__RIMU_MAP_READY__ === true);

  await expect(page.getByTestId("auto-refresh")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByTestId("demo-mode")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByTestId("toggle-links")).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_DEMO_ACTIVE__))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_DEMO_ROUTE_SIZE__))
    .toBe(2);
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_AUTO_REFRESH_ACTIVE__))
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => window.__RIMU_AUTO_REFRESH_REMAINING_SECONDS__ ?? 0)
    )
    .toBeGreaterThan(890);
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_LINKS_VISIBLE__))
    .toBe(false);
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_VISIBLE_SITE_COUNT__))
    .toBe(2);
  await expect(
    page.locator('#legend .legend-button[data-status="bad"]')
  ).toHaveAttribute("aria-pressed", "false");
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
  await expect
    .poll(() => getSearchParam(page, "filters"))
    .toBe("ok,warning,unknown,acknowledged,overdue");

  await badToggle.click();

  await expect(badToggle).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_VISIBLE_SITE_COUNT__))
    .toBe(3);
  await expect
    .poll(() => getSearchParam(page, "filters"))
    .toBeNull();
});

test("filters sites by a single selected tag and combines with statuses", async ({
  page
}) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__RIMU_MAP_READY__ === true);

  const tagInput = page.getByTestId("tag-filter-input");

  await tagInput.click();
  await expect(page.getByRole("option", { name: /^All tags 3$/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /^gnss 2$/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /^mains12 2$/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /^building 1$/ })).toBeVisible();

  await selectTag(page, "gn", /^gnss 2$/);

  await expect(tagInput).toHaveValue("gnss");
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_SELECTED_TAG__))
    .toBe("gnss");
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_VISIBLE_SITE_COUNT__))
    .toBe(2);
  await expect
    .poll(() => getSearchParam(page, "tag"))
    .toBe("gnss");

  await page.locator('#legend .legend-button[data-status="bad"]').click();

  await expect
    .poll(() => page.evaluate(() => window.__RIMU_VISIBLE_SITE_COUNT__))
    .toBe(1);

  await page.getByTestId("tag-filter-clear").click();

  await expect(tagInput).toHaveValue("");
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_SELECTED_TAG__))
    .toBeNull();
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_VISIBLE_SITE_COUNT__))
    .toBe(2);
  await expect
    .poll(() => getSearchParam(page, "tag"))
    .toBeNull();
});

test("loads status and tag filters from query parameters", async ({ page }) => {
  await page.goto("/?filters=ok,warning&tag=gnss");
  await page.waitForFunction(() => window.__RIMU_MAP_READY__ === true);

  await expect(page.getByTestId("tag-filter-input")).toHaveValue("gnss");
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_SELECTED_TAG__))
    .toBe("gnss");
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_VISIBLE_SITE_COUNT__))
    .toBe(1);
  await expect(
    page.locator('#legend .legend-button[data-status="bad"]')
  ).toHaveAttribute("aria-pressed", "false");
});

test("clears unknown tag query parameters after data loads", async ({ page }) => {
  await page.goto("/?tag=missing");
  await page.waitForFunction(() => window.__RIMU_MAP_READY__ === true);

  await expect(page.getByTestId("tag-filter-input")).toHaveValue("");
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_SELECTED_TAG__))
    .toBeNull();
  await expect
    .poll(() => page.evaluate(() => window.__RIMU_VISIBLE_SITE_COUNT__))
    .toBe(3);
  await expect
    .poll(() => getSearchParam(page, "tag"))
    .toBeNull();
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

async function selectTag(
  page: Page,
  query: string,
  optionName: RegExp
): Promise<void> {
  const input = page.getByTestId("tag-filter-input");

  await input.click();
  await input.fill(query);
  await page.getByRole("option", { name: optionName }).click();
}

async function getSearchParam(
  page: Page,
  name: string
): Promise<string | null> {
  return page.evaluate(
    (paramName) => new URL(window.location.href).searchParams.get(paramName),
    name
  );
}
