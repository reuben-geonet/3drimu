import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WakeLockController } from "./wakeLock";

class MockWakeLockSentinel {
  released = false;
  private listeners = new Set<() => void>();

  addEventListener(
    _type: string,
    listener: () => void,
    _options?: AddEventListenerOptions
  ): void {
    this.listeners.add(listener);
  }

  release = vi.fn(async () => {
    this.released = true;
    this.emitRelease();
  });

  emitRelease(): void {
    this.listeners.forEach((listener) => listener());
  }
}

class MockDocument {
  visibilityState: DocumentVisibilityState = "visible";
  private listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  dispatchVisibilityChange(): void {
    this.listeners
      .get("visibilitychange")
      ?.forEach((listener) => listener());
  }
}

describe("WakeLockController", () => {
  const originalNavigator = globalThis.navigator;
  const originalDocument = globalThis.document;

  const flushPromises = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

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
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument
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

    await flushPromises();

    expect(request).toHaveBeenCalledWith("screen");

    controller.setActive(false);

    await flushPromises();

    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it("reacquires the wake lock when the browser revokes it while active", async () => {
    const firstSentinel = new MockWakeLockSentinel();
    const secondSentinel = new MockWakeLockSentinel();
    const request = vi
      .fn()
      .mockResolvedValueOnce(firstSentinel)
      .mockResolvedValueOnce(secondSentinel);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        wakeLock: { request }
      }
    });

    const controller = new WakeLockController();
    controller.setActive(true);
    await flushPromises();

    firstSentinel.emitRelease();
    await flushPromises();

    expect(request).toHaveBeenCalledTimes(2);
  });

  it("releases when the document is hidden and requests again when visible", async () => {
    const mockDocument = new MockDocument();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: mockDocument
    });
    const firstSentinel = new MockWakeLockSentinel();
    const secondSentinel = new MockWakeLockSentinel();
    const request = vi
      .fn()
      .mockResolvedValueOnce(firstSentinel)
      .mockResolvedValueOnce(secondSentinel);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        wakeLock: { request }
      }
    });

    const controller = new WakeLockController();
    controller.setActive(true);
    await flushPromises();

    mockDocument.visibilityState = "hidden";
    mockDocument.dispatchVisibilityChange();
    await flushPromises();

    mockDocument.visibilityState = "visible";
    mockDocument.dispatchVisibilityChange();
    await flushPromises();

    expect(firstSentinel.release).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not keep a lock that resolves after demo mode is disabled", async () => {
    let resolveRequest: (sentinel: MockWakeLockSentinel) => void = () => {
      throw new Error("request was not started");
    };
    const request = vi.fn(
      () =>
        new Promise<MockWakeLockSentinel>((resolve) => {
          resolveRequest = resolve;
        })
    );
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        wakeLock: { request }
      }
    });
    const sentinel = new MockWakeLockSentinel();

    const controller = new WakeLockController();
    controller.setActive(true);
    controller.setActive(false);
    resolveRequest(sentinel);
    await flushPromises();

    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the Wake Lock API is unavailable", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {}
    });

    const controller = new WakeLockController();
    controller.setActive(true);
    await flushPromises();

    expect(true).toBe(true);
  });
});
