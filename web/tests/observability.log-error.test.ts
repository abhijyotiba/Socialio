import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the admin client. The first test runs the happy path (insert
// succeeds); the second forces the insert to throw and asserts logError
// still resolves — the contract is "MUST NEVER THROW".

const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

describe("logError", () => {
  beforeEach(() => {
    insertMock.mockReset();
    fromMock.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("inserts into error_events and emits a structured log line", async () => {
    insertMock.mockResolvedValue({ data: null, error: null });
    const { logError } = await import("@/lib/observability/log-error");
    await logError(new Error("boom"), {
      source: "server",
      origin: "test",
      workspaceId: "w1",
      userId: "u1",
      metadata: { post_id: "p1" },
    });

    expect(fromMock).toHaveBeenCalledWith("error_events");
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0][0];
    expect(row.source).toBe("server");
    expect(row.origin).toBe("test");
    expect(row.workspace_id).toBe("w1");
    expect(row.user_id).toBe("u1");
    expect(row.message).toBe("boom");
    expect(row.metadata).toEqual({ post_id: "p1" });
    expect(typeof row.stack).toBe("string");
  });

  it("never throws even if the insert blows up", async () => {
    insertMock.mockRejectedValue(new Error("supabase down"));
    const { logError } = await import("@/lib/observability/log-error");
    await expect(
      logError(new Error("boom"), { source: "client", origin: "test" })
    ).resolves.toBeUndefined();
  });

  it("uses stackOverride when provided", async () => {
    insertMock.mockResolvedValue({ data: null, error: null });
    const { logError } = await import("@/lib/observability/log-error");
    await logError(new Error("boom"), {
      source: "client",
      origin: "test",
      stackOverride: "explicit stack from client",
    });
    const row = insertMock.mock.calls[0][0];
    expect(row.stack).toBe("explicit stack from client");
  });

  it("truncates messages and stacks beyond their caps", async () => {
    insertMock.mockResolvedValue({ data: null, error: null });
    const { logError } = await import("@/lib/observability/log-error");
    const huge = "x".repeat(10_000);
    const err = new Error(huge);
    err.stack = huge;
    await logError(err, { source: "server", origin: "test" });
    const row = insertMock.mock.calls[0][0];
    expect(row.message.length).toBeLessThanOrEqual(1_024);
    expect(row.stack!.length).toBeLessThanOrEqual(4_096);
  });
});
