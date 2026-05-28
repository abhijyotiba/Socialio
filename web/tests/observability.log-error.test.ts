import { describe, it, expect, vi, beforeEach } from "vitest";

const workerFetchMock = vi.fn();

vi.mock("@/lib/worker-client", () => ({
  workerFetch: workerFetchMock,
}));

describe("logError", () => {
  beforeEach(() => {
    workerFetchMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("inserts into error_events and emits a structured log line", async () => {
    workerFetchMock.mockResolvedValue(new Response());
    const { logError } = await import("@/lib/observability/log-error");
    await logError(new Error("boom"), {
      source: "server",
      origin: "test",
      workspaceId: "w1",
      userId: "u1",
      metadata: { post_id: "p1" },
    });

    expect(workerFetchMock).toHaveBeenCalledTimes(1);
    expect(workerFetchMock).toHaveBeenCalledWith("/system/log-error", expect.objectContaining({
      method: "POST"
    }));
    const payload = workerFetchMock.mock.calls[0][1].json;
    expect(payload.source).toBe("server");
    expect(payload.origin).toBe("test");
    expect(payload.metadata.workspace_id).toBe("w1");
    expect(payload.metadata.user_id).toBe("u1");
    expect(payload.message).toBe("boom");
    expect(payload.metadata.post_id).toBe("p1");
    expect(typeof payload.stack).toBe("string");
  });

  it("never throws even if the insert blows up", async () => {
    workerFetchMock.mockRejectedValue(new Error("worker down"));
    const { logError } = await import("@/lib/observability/log-error");
    await expect(
      logError(new Error("boom"), { source: "client", origin: "test" })
    ).resolves.toBeUndefined();
  });

  it("uses stackOverride when provided", async () => {
    workerFetchMock.mockResolvedValue(new Response());
    const { logError } = await import("@/lib/observability/log-error");
    await logError(new Error("boom"), {
      source: "client",
      origin: "test",
      stackOverride: "explicit stack from client",
    });
    const payload = workerFetchMock.mock.calls[0][1].json;
    expect(payload.stack).toBe("explicit stack from client");
  });

  it("truncates messages and stacks beyond their caps", async () => {
    workerFetchMock.mockResolvedValue(new Response());
    const { logError } = await import("@/lib/observability/log-error");
    const huge = "x".repeat(10_000);
    const err = new Error(huge);
    err.stack = huge;
    await logError(err, { source: "server", origin: "test" });
    const payload = workerFetchMock.mock.calls[0][1].json;
    expect(payload.message.length).toBeLessThanOrEqual(1_024);
    expect(payload.stack!.length).toBeLessThanOrEqual(4_096);
  });
});

