import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdateRefreshController } from "./updateRefresh";

function jsonResponse(version: string): Response {
  return {
    ok: true,
    json: async () => ({ version })
  } as Response;
}

describe("AppUpdateRefreshController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-09T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records the first version without reloading", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse("abc123"));
    const reload = vi.fn();
    const onVersion = vi.fn();
    const controller = new AppUpdateRefreshController({
      fetchImpl,
      reload,
      onVersion,
      manifestUrl: "/version.json"
    });

    await controller.checkNow();

    expect(onVersion).toHaveBeenCalledWith("abc123");
    expect(reload).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost/version.json?t=1783555200000",
      {
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    );
  });

  it("reloads after a changed version is detected", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse("abc123"))
      .mockResolvedValueOnce(jsonResponse("def456"));
    const reload = vi.fn();
    const onUpdateDetected = vi.fn();
    const controller = new AppUpdateRefreshController({
      fetchImpl,
      reload,
      onUpdateDetected,
      reloadDelayMs: 250,
      manifestUrl: "/version.json"
    });

    await controller.checkNow();
    await controller.checkNow();

    expect(onUpdateDetected).toHaveBeenCalledWith("def456", "abc123");
    expect(reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps polling while versions match", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse("abc123"));
    const reload = vi.fn();
    const controller = new AppUpdateRefreshController({
      fetchImpl,
      reload,
      intervalMs: 1_000,
      manifestUrl: "/version.json"
    });

    controller.start();
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(reload).not.toHaveBeenCalled();

    controller.stop();
  });
});
