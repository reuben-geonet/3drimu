type WakeLockSentinel = {
  release: () => Promise<void>;
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
        if (this.active && document.visibilityState === "visible") {
          void this.requestWakeLock();
        }
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
    if (this.requestPending || this.sentinel || !this.isSupported()) {
      return;
    }

    console.log("WakeLock Supported: ", this.isSupported());
    this.requestPending = true;

    try {
      const wakeLock = (navigator as Navigator & NavigatorWithWakeLock).wakeLock;
      this.sentinel = wakeLock ? await wakeLock.request("screen") : null;

      if (this.sentinel) {
        console.log("WakeLock acquired successfully");
      }
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
    return typeof navigator !== "undefined" && "wakeLock" in navigator;
  }
}
