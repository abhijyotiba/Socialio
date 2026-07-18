import { describe, it, expect, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const getWorkspaceForUserMock = vi.fn();
const getUnreadNotificationsMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
  }),
}));

vi.mock("@/lib/db/workspaces", () => ({
  getWorkspaceForUser: getWorkspaceForUserMock,
}));

vi.mock("@/lib/db/notifications", () => ({
  getUnreadNotifications: getUnreadNotificationsMock,
}));

describe("GET /api/notifications", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    getWorkspaceForUserMock.mockReset();
    getUnreadNotificationsMock.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const { GET } = await import("@/app/api/notifications/route");
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(getUnreadNotificationsMock).not.toHaveBeenCalled();
  });

  it("returns the workspace's unread notifications", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
    getWorkspaceForUserMock.mockResolvedValue({ workspace_id: "ws1" });
    const rows = [
      {
        id: "n1",
        workspace_id: "ws1",
        persona_id: "p1",
        kind: "publish_failed",
        title: "Publishing to linkedin failed",
        body: "boom",
        entity_type: "post_variant",
        entity_id: "v1",
        read_at: null,
        created_at: "2026-07-18T00:00:00Z",
      },
    ];
    getUnreadNotificationsMock.mockResolvedValue(rows);

    const { GET } = await import("@/app/api/notifications/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notifications: rows });
    expect(getUnreadNotificationsMock).toHaveBeenCalledWith("ws1");
  });

  it("returns an empty list when the user has no workspace", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
    getWorkspaceForUserMock.mockResolvedValue(null);

    const { GET } = await import("@/app/api/notifications/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notifications: [] });
    expect(getUnreadNotificationsMock).not.toHaveBeenCalled();
  });
});
