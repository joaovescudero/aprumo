// with-retry unit tests (RED — written before with-retry.ts exists).
// Per API-10: withRetryOnSerializationFailure retries the full factory fn on SQLSTATE 40001
// up to 3 times, then re-throws. Non-40001 errors propagate immediately.
// Per CLAUDE.md Invariant #5: SERIALIZABLE isolation level + 40001 retry in application code.
//
// Wave dependency: Plan 03 (this plan). No DB needed — pure unit tests with vi.fn() mocks.
// Tests are RED until with-retry.ts is implemented.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withRetryOnSerializationFailure } from "./with-retry.js";

describe("withRetryOnSerializationFailure", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the value when fn succeeds on first call", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await withRetryOnSerializationFailure(fn);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries and succeeds on second attempt when first throws 40001", async () => {
    const err40001 = Object.assign(new Error("serialization failure"), { code: "40001" });
    const fn = vi.fn().mockRejectedValueOnce(err40001).mockResolvedValueOnce("ok");

    const promise = withRetryOnSerializationFailure(fn);
    // Advance fake timers to allow the backoff delay (first retry: 50ms)
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("re-throws after exhausting MAX_RETRIES (3 retries, 4 total calls) when all throw 40001", async () => {
    const err40001 = Object.assign(new Error("serialization failure"), { code: "40001" });
    const fn = vi.fn().mockRejectedValue(err40001);

    const promise = withRetryOnSerializationFailure(fn);
    // Advance timers through all 3 retry delays: 50ms, 100ms, 200ms
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);

    await expect(promise).rejects.toMatchObject({ code: "40001" });
    // 1 initial attempt + 3 retries = 4 total calls
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("throws immediately without retry when error code is not 40001", async () => {
    const err23505 = Object.assign(new Error("unique violation"), { code: "23505" });
    const fn = vi.fn().mockRejectedValueOnce(err23505);

    await expect(withRetryOnSerializationFailure(fn)).rejects.toMatchObject({ code: "23505" });
    // Called exactly once — no retry for non-40001 errors
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
