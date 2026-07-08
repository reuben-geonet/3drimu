type WakeLockSentinel = {
  release: () => Promise<void>;
  addEventListener: (
    type: "release",
    listener: () => void,
    options?: AddEventListenerOptions
  ) => void;
};

type WakeLockManager = {
  request: (type: "screen") => Promise<WakeLockSentinel>;
};

interface NavigatorWithWakeLock {
  wakeLock?: WakeLockManager;
}

export class WakeLockController {
  private active = false;
  private sentinel: WakeLockSentinel | null = null;
  private requestPending = false;

  constructor() {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (this.canHoldWakeLock()) {
          void this.requestWakeLock();
          return;
        }

        void this.releaseWakeLock();
      });
    }
  }

  setActive(active: boolean): void {
    if (this.active === active) {
      return;
    }

    this.active = active;

    if (active) {
      void this.requestWakeLock();
      return;
    }

    void this.releaseWakeLock();
  }

  private async requestWakeLock(): Promise<void> {
    if (this.requestPending || this.sentinel || !this.canHoldWakeLock()) {
      return;
    }

    this.requestPending = true;

    try {
      const wakeLock = this.getWakeLock();
      const sentinel = await wakeLock.request("screen");
      sentinel.addEventListener(
        "release",
        () => this.onWakeLockReleased(sentinel),
        { once: true }
      );

      if (!this.canHoldWakeLock()) {
        await sentinel.release();
        return;
      }

      this.sentinel = sentinel;
    } catch {
      this.sentinel = null;
    } finally {
      this.requestPending = false;
    }
  }

  private async releaseWakeLock(): Promise<void> {
    if (!this.sentinel) {
      return;
    }

    const sentinel = this.sentinel;
    this.sentinel = null;

    try {
      await sentinel.release();
    } catch {
      // Ignore release failures and allow the page to continue.
    }
  }

  private isSupported(): boolean {
    if (typeof navigator === "undefined") {
      return false;
    }

    const wakeLock = (navigator as Navigator & NavigatorWithWakeLock).wakeLock;
    return typeof wakeLock?.request === "function";
  }

  private canHoldWakeLock(): boolean {
    return this.active && this.isVisible() && this.isSupported();
  }

  private isVisible(): boolean {
    return typeof document === "undefined" || document.visibilityState === "visible";
  }

  private getWakeLock(): WakeLockManager {
    const wakeLock = (navigator as Navigator & NavigatorWithWakeLock).wakeLock;

    if (!wakeLock) {
      throw new Error("Screen Wake Lock API is unavailable");
    }

    return wakeLock;
  }

  private onWakeLockReleased(sentinel: WakeLockSentinel): void {
    if (this.sentinel !== sentinel) {
      return;
    }

    this.sentinel = null;

    if (this.canHoldWakeLock()) {
      void this.requestWakeLock();
    }
  }
}
