import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WakeLockController } from "./wakeLock";

class MockWakeLockSentinel {
  released = false;
  private listeners = new Set<() => void>();

  addEventListener(_type: string, listener: () => void): void {
    this.listeners.add(listener);
  }

  release = vi.fn(async () => {
    this.released = true;
    this.listeners.forEach((listener) => listener());
  });
}

describe("WakeLockController", () => {
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        wakeLock: {
          request: vi.fn()
        }
      }
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator
    });
  });

  it("requests wake lock while demo mode is active and releases it when disabled", async () => {
    const sentinel = new MockWakeLockSentinel();
    const request = vi.fn().mockResolvedValue(sentinel);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        wakeLock: { request }
      }
    });

    const controller = new WakeLockController();
    controller.setActive(true);

    await Promise.resolve();
    await Promise.resolve();

    expect(request).toHaveBeenCalledWith("screen");

    controller.setActive(false);

    await Promise.resolve();
    await Promise.resolve();

    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });
});
