import { describe, it, expect, vi } from "vitest";
import { pollIngestion, type IngestionJob } from "@/lib/chat/poll-ingestion";

describe("pollIngestion", () => {
  it("resolves with the job when it reaches 'done'", async () => {
    // First poll: still scraping. Second poll: done.
    const fetchJob = vi
      .fn<() => Promise<IngestionJob | null>>()
      .mockResolvedValueOnce({ stage: "scraping" })
      .mockResolvedValueOnce({ stage: "done", extracted_text: "hello" });

    const onStage = vi.fn();
    const job = await pollIngestion("job-1", {
      fetchJob,
      intervalMs: 1,
      timeoutMs: 1000,
      onStage,
    });

    expect(job.stage).toBe("done");
    expect(job.extracted_text).toBe("hello");
    // The interim non-terminal stage was reported.
    expect(onStage).toHaveBeenCalledWith("scraping");
  });

  it("resolves with the job when it reaches 'failed' (does not throw)", async () => {
    const fetchJob = vi
      .fn<() => Promise<IngestionJob | null>>()
      .mockResolvedValue({ stage: "failed", error: "scrape blew up" });

    const job = await pollIngestion("job-1", {
      fetchJob,
      intervalMs: 1,
      timeoutMs: 1000,
    });

    expect(job.stage).toBe("failed");
    expect(job.error).toBe("scrape blew up");
  });

  it("rejects with a timeout error if the job never finishes", async () => {
    const fetchJob = vi
      .fn<() => Promise<IngestionJob | null>>()
      .mockResolvedValue({ stage: "scraping" });

    await expect(
      pollIngestion("job-1", { fetchJob, intervalMs: 1, timeoutMs: 20 })
    ).rejects.toThrow(/timed out/i);
  });

  it("keeps polling through transient fetch errors (null) rather than giving up", async () => {
    const fetchJob = vi
      .fn<() => Promise<IngestionJob | null>>()
      .mockResolvedValueOnce(null) // transient hiccup
      .mockResolvedValueOnce({ stage: "done" });

    const job = await pollIngestion("job-1", {
      fetchJob,
      intervalMs: 1,
      timeoutMs: 1000,
    });

    expect(job.stage).toBe("done");
    expect(fetchJob).toHaveBeenCalledTimes(2);
  });
});
