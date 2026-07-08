export interface AppVersionManifest {
  version?: unknown;
}

export interface AppUpdateRefreshOptions {
  intervalMs?: number;
  reloadDelayMs?: number;
  manifestUrl?: string;
  fetchImpl?: typeof fetch;
  reload?: () => void;
  onVersion?: (version: string) => void;
  onUpdateDetected?: (nextVersion: string, previousVersion: string) => void;
  onError?: (error: unknown) => void;
}

const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 2 * 60_000;
const DEFAULT_RELOAD_DELAY_MS = 2_500;
const DEFAULT_VERSION_MANIFEST_URL = `${import.meta.env.BASE_URL}version.json`;

export class AppUpdateRefreshController {
  private readonly intervalMs: number;
  private readonly reloadDelayMs: number;
  private readonly manifestUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly reload: () => void;
  private readonly onVersion: (version: string) => void;
  private readonly onUpdateDetected: (
    nextVersion: string,
    previousVersion: string
  ) => void;
  private readonly onError: (error: unknown) => void;
  private currentVersion: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private updateDetected = false;

  constructor(options: AppUpdateRefreshOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_UPDATE_CHECK_INTERVAL_MS;
    this.reloadDelayMs = options.reloadDelayMs ?? DEFAULT_RELOAD_DELAY_MS;
    this.manifestUrl = options.manifestUrl ?? DEFAULT_VERSION_MANIFEST_URL;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.reload = options.reload ?? (() => window.location.reload());
    this.onVersion = options.onVersion ?? (() => undefined);
    this.onUpdateDetected = options.onUpdateDetected ?? (() => undefined);
    this.onError =
      options.onError ??
      ((error) => {
        console.warn("Unable to check app version", error);
      });
  }

  start(): void {
    if (this.active) {
      return;
    }

    this.active = true;
    void this.checkNow().finally(() => this.scheduleNextCheck());
  }

  stop(): void {
    this.active = false;

    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  async checkNow(): Promise<void> {
    if (this.updateDetected) {
      return;
    }

    try {
      const nextVersion = await this.fetchVersion();

      if (nextVersion === undefined) {
        return;
      }

      if (this.currentVersion === undefined) {
        this.currentVersion = nextVersion;
        this.onVersion(nextVersion);
        return;
      }

      if (nextVersion === this.currentVersion) {
        this.onVersion(nextVersion);
        return;
      }

      const previousVersion = this.currentVersion;
      this.currentVersion = nextVersion;
      this.updateDetected = true;
      this.onVersion(nextVersion);
      this.onUpdateDetected(nextVersion, previousVersion);
      this.scheduleReload();
    } catch (error) {
      this.onError(error);
    }
  }

  private async fetchVersion(): Promise<string | undefined> {
    const response = await this.fetchImpl(this.getCacheBypassUrl(), {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText} for ${this.manifestUrl}`);
    }

    const manifest = (await response.json()) as AppVersionManifest;

    return normalizeVersion(manifest.version);
  }

  private getCacheBypassUrl(): string {
    const url = new URL(this.manifestUrl, globalThis.location?.href ?? "http://localhost/");

    url.searchParams.set("t", String(Date.now()));

    return url.href;
  }

  private scheduleNextCheck(): void {
    if (!this.active || this.updateDetected) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.checkNow().finally(() => this.scheduleNextCheck());
    }, this.intervalMs);
  }

  private scheduleReload(): void {
    this.stop();
    setTimeout(this.reload, this.reloadDelayMs);
  }
}

export function startAppUpdateRefresh(
  options?: AppUpdateRefreshOptions
): AppUpdateRefreshController {
  const controller = new AppUpdateRefreshController(options);

  controller.start();

  return controller;
}

function normalizeVersion(version: unknown): string | undefined {
  if (typeof version !== "string") {
    return undefined;
  }

  const normalized = version.trim();

  return normalized === "" ? undefined : normalized;
}
