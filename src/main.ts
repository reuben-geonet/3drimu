import "./styles.css";
import { loadRimuMapData } from "./api";
import { MapScene, renderLegend } from "./scene";
import { RIMU_STATUSES, STATUS_LABELS } from "./status";
import { ThemeController } from "./theme";
import type { RimuStatus, SiteMarker } from "./types";

const MIN_LOADING_MS = 2400;
const CONTROL_ANIMATION_MS = 620;
const REFRESH_SPIN_MS = 650;
const buttonAnimationTimers = new WeakMap<HTMLButtonElement, number>();

declare global {
  interface Window {
    __RIMU_MAP_READY__?: boolean;
    __RIMU_SITE_COUNT__?: number;
    __RIMU_VISIBLE_SITE_COUNT__?: number;
    __RIMU_LAST_LOAD_SOURCE__?: "live" | "fallback";
  }
}

const sceneRoot = requiredElement("scene-root");
const loadingOverlay = requiredElement("loading-overlay");
const loadingCopy = requiredElement("loading-copy");
const legend = requiredElement("legend");
const tooltip = requiredElement("tooltip");
const themeToggle = requiredElement<HTMLButtonElement>("theme-toggle");
const resetView = requiredElement<HTMLButtonElement>("reset-view");
const refreshData = requiredElement<HTMLButtonElement>("refresh-data");

const theme = new ThemeController(themeToggle);
const map = new MapScene(sceneRoot, {
  onMarkerHover: renderTooltip
});
const visibleStatuses = new Set<RimuStatus>(RIMU_STATUSES);

theme.onChange((nextTheme) => map.setTheme(nextTheme));
map.setTheme(theme.theme);
renderLegend(legend, visibleStatuses);
legend.addEventListener("click", onLegendClick);
themeToggle.addEventListener("click", () => {
  playButtonAnimation(themeToggle, "is-theme-shifting", CONTROL_ANIMATION_MS);
});
resetView.addEventListener("click", () => {
  playButtonAnimation(resetView, "is-resetting", CONTROL_ANIMATION_MS);
  map.resetView();
});
refreshData.addEventListener("click", () => void refresh());

void boot();

async function boot(): Promise<void> {
  window.__RIMU_MAP_READY__ = false;
  setLoadingCopy("Acquiring live RIMU telemetry");
  const startedAt = performance.now();
  const data = await loadRimuMapData();
  const remaining = Math.max(0, MIN_LOADING_MS - (performance.now() - startedAt));

  setLoadingCopy("Calibrating New Zealand map view");
  await delay(remaining);
  map.setData(data.sites, data.links);
  syncVisibleSiteCount();
  loadingOverlay.classList.add("is-hidden");
  await map.startIntro();
  window.__RIMU_MAP_READY__ = true;
  window.__RIMU_SITE_COUNT__ = data.sites.length;
  window.__RIMU_LAST_LOAD_SOURCE__ = data.loadedFromLiveApi ? "live" : "fallback";
}

async function refresh(): Promise<void> {
  refreshData.disabled = true;
  refreshData.classList.add("is-refreshing");
  const startedAt = performance.now();

  try {
    const data = await loadRimuMapData();
    map.setData(data.sites, data.links);
    syncVisibleSiteCount();
    window.__RIMU_SITE_COUNT__ = data.sites.length;
    window.__RIMU_LAST_LOAD_SOURCE__ = data.loadedFromLiveApi ? "live" : "fallback";
  } finally {
    const remainingSpinMs = Math.max(0, REFRESH_SPIN_MS - (performance.now() - startedAt));
    await delay(remainingSpinMs);
    refreshData.classList.remove("is-refreshing");
    refreshData.disabled = false;
  }
}

function renderTooltip(site: SiteMarker | null, point?: { x: number; y: number }): void {
  if (!site || !point) {
    tooltip.classList.remove("is-visible");
    return;
  }

  const fieldSummary = Object.entries(site.fieldStatus)
    .slice(0, 4)
    .map(([field, status]) => `${field}: ${STATUS_LABELS[status]}`)
    .join(", ");
  const tags = site.tags.slice(0, 8).join(", ");

  tooltip.innerHTML = `
    <h2>${escapeHtml(site.locality)}</h2>
    <dl>
      <dt>Status</dt><dd>${STATUS_LABELS[site.status]}</dd>
      <dt>Site</dt><dd>${escapeHtml(site.sitecode ?? "N/A")}</dd>
      <dt>Devices</dt><dd>${site.devices.length}</dd>
      <dt>Fields</dt><dd>${escapeHtml(fieldSummary || "No current fault fields")}</dd>
      <dt>Tags</dt><dd>${escapeHtml(tags || "N/A")}</dd>
    </dl>
  `;
  tooltip.style.left = `${Math.min(point.x + 16, window.innerWidth - 360)}px`;
  tooltip.style.top = `${Math.min(point.y + 16, window.innerHeight - 220)}px`;
  tooltip.classList.add("is-visible");
}

function onLegendClick(event: MouseEvent): void {
  const status = getLegendStatus(event.target);

  if (!status) {
    return;
  }

  if (visibleStatuses.has(status)) {
    visibleStatuses.delete(status);
  } else {
    visibleStatuses.add(status);
  }

  map.setVisibleStatuses(visibleStatuses);
  renderLegend(legend, visibleStatuses);
  syncVisibleSiteCount();
}

function getLegendStatus(target: EventTarget | null): RimuStatus | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const button = target.closest<HTMLButtonElement>(".legend-button[data-status]");
  const status = button?.dataset.status;

  if (!button || !legend.contains(button) || !isRimuStatus(status)) {
    return null;
  }

  return status;
}

function isRimuStatus(status: string | undefined): status is RimuStatus {
  return (
    typeof status === "string" && RIMU_STATUSES.includes(status as RimuStatus)
  );
}

function syncVisibleSiteCount(): void {
  window.__RIMU_VISIBLE_SITE_COUNT__ = map.getVisibleSiteCount();
}

function setLoadingCopy(copy: string): void {
  loadingCopy.textContent = copy;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function playButtonAnimation(
  button: HTMLButtonElement,
  className: string,
  durationMs: number
): void {
  const previousTimer = buttonAnimationTimers.get(button);

  if (previousTimer !== undefined) {
    window.clearTimeout(previousTimer);
  }

  button.classList.remove(className);
  void button.offsetWidth;
  button.classList.add(className);

  const nextTimer = window.setTimeout(() => {
    button.classList.remove(className);
    buttonAnimationTimers.delete(button);
  }, durationMs);

  buttonAnimationTimers.set(button, nextTimer);
}

function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }

  return element as T;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[character] ?? character
  );
}
