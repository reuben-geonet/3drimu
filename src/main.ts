import "./styles.css";
import { getRimuChartUrl, loadRimuMapData } from "./api";
import { MapScene, renderLegend, type DemoModeState } from "./scene";
import { RIMU_STATUSES, STATUS_LABELS } from "./status";
import { ThemeController } from "./theme";
import type { RimuStatus, SiteMarker } from "./types";

const MIN_LOADING_MS = 2400;
const CONTROL_ANIMATION_MS = 620;
const REFRESH_SPIN_MS = 650;
const AUTO_REFRESH_INTERVAL_MS = 15 * 60_000;
const AUTO_REFRESH_COUNTDOWN_TICK_MS = 1_000;
const buttonAnimationTimers = new WeakMap<HTMLButtonElement, number>();

interface InitialBrowserConfig {
  autoRefresh?: boolean;
  demoMode?: boolean;
  radioLink?: boolean;
  filters?: Set<RimuStatus>;
}

declare global {
  interface Window {
    __RIMU_MAP_READY__?: boolean;
    __RIMU_SITE_COUNT__?: number;
    __RIMU_VISIBLE_SITE_COUNT__?: number;
    __RIMU_LINK_COUNT__?: number;
    __RIMU_LINKS_VISIBLE__?: boolean;
    __RIMU_AUTO_REFRESH_ACTIVE__?: boolean;
    __RIMU_AUTO_REFRESH_REMAINING_SECONDS__?: number;
    __RIMU_DEMO_ACTIVE__?: boolean;
    __RIMU_DEMO_ROUTE_SIZE__?: number;
    __RIMU_DEMO_CURRENT_SITE__?: string | null;
    __RIMU_FULLSCREEN_ACTIVE__?: boolean;
    __RIMU_LAST_LOAD_SOURCE__?: "live" | "fallback";
  }
}

const sceneRoot = requiredElement("scene-root");
const loadingOverlay = requiredElement("loading-overlay");
const legend = requiredElement("legend");
const tooltip = requiredElement("tooltip");
const themeToggle = requiredElement<HTMLButtonElement>("theme-toggle");
const resetView = requiredElement<HTMLButtonElement>("reset-view");
const refreshData = requiredElement<HTMLButtonElement>("refresh-data");
const autoRefresh = requiredElement<HTMLButtonElement>("auto-refresh");
const toggleLinks = requiredElement<HTMLButtonElement>("toggle-links");
const demoMode = requiredElement<HTMLButtonElement>("demo-mode");
const fullscreenToggle = requiredElement<HTMLButtonElement>("fullscreen-toggle");
const initialBrowserConfig = getInitialBrowserConfig();

const theme = new ThemeController(themeToggle);
const map = new MapScene(sceneRoot, {
  onMarkerHover: renderTooltip,
  onMarkerClick: openRimuChart,
  onDemoStateChange: syncDemoToggle
});
const visibleStatuses = new Set<RimuStatus>(RIMU_STATUSES);
let autoRefreshActive = false;
let autoRefreshTimer: number | undefined;
let autoRefreshCountdownTimer: number | undefined;
let nextAutoRefreshAt: number | undefined;
let refreshInFlight: Promise<void> | undefined;

theme.onChange((nextTheme) => map.setTheme(nextTheme));
map.setTheme(theme.theme);
applyInitialFilterConfig(initialBrowserConfig);
renderLegend(legend, visibleStatuses);
syncLinkToggle();
syncAutoRefreshToggle();
syncDemoToggle();
syncFullscreenToggle();
legend.addEventListener("click", onLegendClick);
themeToggle.addEventListener("click", () => {
  playButtonAnimation(themeToggle, "is-theme-shifting", CONTROL_ANIMATION_MS);
});
resetView.addEventListener("click", () => {
  playButtonAnimation(resetView, "is-resetting", CONTROL_ANIMATION_MS);
  map.resetView();
});
refreshData.addEventListener("click", () => void refresh());
autoRefresh.addEventListener("click", onAutoRefreshClick);
toggleLinks.addEventListener("click", onToggleLinksClick);
demoMode.addEventListener("click", onDemoModeClick);
fullscreenToggle.addEventListener("click", () => void onFullscreenToggleClick());
document.addEventListener("fullscreenchange", syncFullscreenToggle);
document.addEventListener("fullscreenerror", syncFullscreenToggle);

void boot();

async function boot(): Promise<void> {
  window.__RIMU_MAP_READY__ = false;
  const startedAt = performance.now();
  const data = await loadRimuMapData();
  const remaining = Math.max(0, MIN_LOADING_MS - (performance.now() - startedAt));

  await delay(remaining);
  map.setData(data.sites, data.links);
  applyInitialLinkConfig(initialBrowserConfig);
  syncVisibleSiteCount();
  syncLinkToggle();
  loadingOverlay.classList.add("is-hidden");
  await map.startIntro();
  applyInitialAutoRefreshConfig(initialBrowserConfig);
  applyInitialDemoConfig(initialBrowserConfig);
  syncBrowserUrlConfig();
  window.__RIMU_MAP_READY__ = true;
  window.__RIMU_SITE_COUNT__ = data.sites.length;
  window.__RIMU_LAST_LOAD_SOURCE__ = data.loadedFromLiveApi ? "live" : "fallback";
}

async function refresh(): Promise<void> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = refreshOnce().finally(() => {
    refreshInFlight = undefined;
  });

  return refreshInFlight;
}

async function refreshOnce(): Promise<void> {
  refreshData.disabled = true;
  refreshData.classList.add("is-refreshing");
  const startedAt = performance.now();

  try {
    const data = await loadRimuMapData();
    map.setData(data.sites, data.links);
    syncVisibleSiteCount();
    syncLinkToggle();
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

function openRimuChart(site: SiteMarker): void {
  window.open(getRimuChartUrl(site.locality), "_blank", "noopener,noreferrer");
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
  syncBrowserUrlConfig();
}

function onToggleLinksClick(): void {
  map.setLinksVisible(!map.getLinksVisible());
  syncLinkToggle();
  syncBrowserUrlConfig();
  playButtonAnimation(toggleLinks, "is-link-toggling", CONTROL_ANIMATION_MS);
}

function onAutoRefreshClick(): void {
  const nextActive = !autoRefreshActive;

  setAutoRefreshActive(nextActive);
  syncBrowserUrlConfig();
  playButtonAnimation(
    autoRefresh,
    "is-auto-refresh-toggling",
    CONTROL_ANIMATION_MS
  );

  if (nextActive) {
    void refresh();
  }
}

function onDemoModeClick(): void {
  map.setDemoMode(!map.getDemoModeState().active);
  syncDemoToggle();
  syncBrowserUrlConfig();
  playButtonAnimation(demoMode, "is-demo-toggling", CONTROL_ANIMATION_MS);
}

async function onFullscreenToggleClick(): Promise<void> {
  if (!document.fullscreenEnabled && !document.fullscreenElement) {
    syncFullscreenToggle();
    return;
  }

  playButtonAnimation(
    fullscreenToggle,
    "is-fullscreen-switching",
    CONTROL_ANIMATION_MS
  );

  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    // Browser policy can reject fullscreen even after a user gesture.
  } finally {
    syncFullscreenToggle();
  }
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

function syncLinkToggle(): void {
  const visible = map.getLinksVisible();

  toggleLinks.classList.toggle("is-active", visible);
  toggleLinks.setAttribute("aria-pressed", String(visible));
  toggleLinks.setAttribute("aria-label", `${visible ? "Hide" : "Show"} radio links`);
  window.__RIMU_LINK_COUNT__ = map.getLinkCount();
  window.__RIMU_LINKS_VISIBLE__ = visible;
}

function syncAutoRefreshToggle(): void {
  const countdownMs = getAutoRefreshRemainingMs();
  const label = autoRefresh.querySelector<HTMLElement>(".control-label");

  autoRefresh.classList.toggle("is-active", autoRefreshActive);
  autoRefresh.setAttribute("aria-pressed", String(autoRefreshActive));
  autoRefresh.setAttribute(
    "aria-label",
    getAutoRefreshAriaLabel(countdownMs)
  );

  if (label) {
    label.textContent = getAutoRefreshLabel(countdownMs);
  }

  window.__RIMU_AUTO_REFRESH_ACTIVE__ = autoRefreshActive;
  window.__RIMU_AUTO_REFRESH_REMAINING_SECONDS__ =
    autoRefreshActive && countdownMs !== undefined
      ? Math.ceil(countdownMs / 1000)
      : undefined;
}

function syncDemoToggle(state: DemoModeState = map.getDemoModeState()): void {
  demoMode.classList.toggle("is-active", state.active);
  demoMode.setAttribute("aria-pressed", String(state.active));
  demoMode.setAttribute("aria-label", `${state.active ? "Stop" : "Start"} demo loop`);
  window.__RIMU_DEMO_ACTIVE__ = state.active;
  window.__RIMU_DEMO_ROUTE_SIZE__ = state.routeSize;
  window.__RIMU_DEMO_CURRENT_SITE__ = state.currentSiteName;
}

function syncFullscreenToggle(): void {
  const active = document.fullscreenElement !== null;
  const supported = document.fullscreenEnabled || active;
  const label = fullscreenToggle.querySelector<HTMLElement>(".control-label");

  fullscreenToggle.disabled = !supported;
  fullscreenToggle.classList.toggle("is-active", active);
  fullscreenToggle.setAttribute("aria-pressed", String(active));
  fullscreenToggle.setAttribute("aria-label", `${active ? "Exit" : "Enter"} fullscreen`);

  if (label) {
    label.textContent = active ? "Exit Fullscreen" : "Fullscreen";
  }

  window.__RIMU_FULLSCREEN_ACTIVE__ = active;
}

function setAutoRefreshActive(active: boolean): void {
  autoRefreshActive = active;

  clearAutoRefreshTimers();

  if (active) {
    scheduleNextAutoRefresh();
    startAutoRefreshCountdown();
  }

  syncAutoRefreshToggle();
}

function scheduleNextAutoRefresh(): void {
  if (autoRefreshTimer !== undefined) {
    window.clearTimeout(autoRefreshTimer);
  }

  nextAutoRefreshAt = Date.now() + AUTO_REFRESH_INTERVAL_MS;
  autoRefreshTimer = window.setTimeout(() => {
    autoRefreshTimer = undefined;
    nextAutoRefreshAt = undefined;
    syncAutoRefreshToggle();

    void refresh().finally(() => {
      if (autoRefreshActive) {
        scheduleNextAutoRefresh();
      }
    });
  }, AUTO_REFRESH_INTERVAL_MS);
  syncAutoRefreshToggle();
}

function startAutoRefreshCountdown(): void {
  autoRefreshCountdownTimer = window.setInterval(
    syncAutoRefreshToggle,
    AUTO_REFRESH_COUNTDOWN_TICK_MS
  );
}

function clearAutoRefreshTimers(): void {
  if (autoRefreshTimer !== undefined) {
    window.clearTimeout(autoRefreshTimer);
    autoRefreshTimer = undefined;
  }

  if (autoRefreshCountdownTimer !== undefined) {
    window.clearInterval(autoRefreshCountdownTimer);
    autoRefreshCountdownTimer = undefined;
  }

  nextAutoRefreshAt = undefined;
}

function getAutoRefreshRemainingMs(): number | undefined {
  if (!autoRefreshActive || nextAutoRefreshAt === undefined) {
    return undefined;
  }

  return Math.max(0, nextAutoRefreshAt - Date.now());
}

function getAutoRefreshLabel(countdownMs: number | undefined): string {
  if (!autoRefreshActive) {
    return "Auto Refresh";
  }

  if (countdownMs === undefined) {
    return "Refreshing...";
  }

  return `Next ${formatCountdown(countdownMs)}`;
}

function getAutoRefreshAriaLabel(countdownMs: number | undefined): string {
  if (!autoRefreshActive) {
    return "Enable auto refresh";
  }

  if (countdownMs === undefined) {
    return "Disable auto refresh, refresh in progress";
  }

  return `Disable auto refresh, next refresh in ${formatCountdownLong(countdownMs)}`;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatCountdownLong(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const minuteUnit = minutes === 1 ? "minute" : "minutes";
  const secondUnit = seconds === 1 ? "second" : "seconds";

  if (minutes === 0) {
    return `${seconds} ${secondUnit}`;
  }

  return `${minutes} ${minuteUnit} ${seconds} ${secondUnit}`;
}

function applyInitialAutoRefreshConfig(config: InitialBrowserConfig): void {
  if (config.autoRefresh === undefined) {
    return;
  }

  setAutoRefreshActive(config.autoRefresh);
}

function applyInitialLinkConfig(config: InitialBrowserConfig): void {
  if (config.radioLink === undefined) {
    return;
  }

  map.setLinksVisible(config.radioLink);
}

function applyInitialFilterConfig(config: InitialBrowserConfig): void {
  if (config.filters === undefined) {
    return;
  }

  visibleStatuses.clear();

  for (const status of config.filters) {
    visibleStatuses.add(status);
  }

  map.setVisibleStatuses(visibleStatuses);
}

function applyInitialDemoConfig(config: InitialBrowserConfig): void {
  if (config.demoMode === undefined) {
    return;
  }

  map.setDemoMode(config.demoMode);
  syncDemoToggle();
}

function getInitialBrowserConfig(): InitialBrowserConfig {
  const params = new URLSearchParams(window.location.search);

  return {
    autoRefresh: parseBooleanQueryParam(params.get("autoRefresh")),
    demoMode: parseBooleanQueryParam(params.get("demoMode")),
    radioLink: parseBooleanQueryParam(params.get("radioLink")),
    filters: parseStatusFilterQueryParam(params.get("filters"))
  };
}

function parseBooleanQueryParam(value: string | null): boolean | undefined {
  if (value === null) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return undefined;
}

function parseStatusFilterQueryParam(value: string | null): Set<RimuStatus> | undefined {
  if (value === null) {
    return undefined;
  }

  const statuses = new Set<RimuStatus>();

  for (const rawStatus of value.split(",")) {
    const status = rawStatus.trim().toLowerCase();

    if (isRimuStatus(status)) {
      statuses.add(status);
    }
  }

  return statuses;
}

function syncBrowserUrlConfig(): void {
  const params = new URLSearchParams(window.location.search);

  syncBooleanUrlParam(params, "autoRefresh", autoRefreshActive, false);
  syncBooleanUrlParam(params, "demoMode", map.getDemoModeState().active, false);
  syncBooleanUrlParam(params, "radioLink", map.getLinksVisible(), true);
  syncFilterUrlParam(params);

  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${
    window.location.hash
  }`;
  const currentUrl = `${window.location.pathname}${window.location.search}${
    window.location.hash
  }`;

  if (nextUrl !== currentUrl) {
    window.history.replaceState(window.history.state, "", nextUrl);
  }
}

function syncBooleanUrlParam(
  params: URLSearchParams,
  name: string,
  value: boolean,
  defaultValue: boolean
): void {
  if (value === defaultValue) {
    params.delete(name);
    return;
  }

  params.set(name, String(value));
}

function syncFilterUrlParam(params: URLSearchParams): void {
  const visibleFilters = RIMU_STATUSES.filter((status) => visibleStatuses.has(status));

  if (visibleFilters.length === RIMU_STATUSES.length) {
    params.delete("filters");
    return;
  }

  params.set("filters", visibleFilters.join(","));
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
