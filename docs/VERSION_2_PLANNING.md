# SocialOS Version 2 (V2) Planning & Improvements

This document outlines the strategic roadmap for SocialOS V2, focusing on deferred V1 features, architectural upgrades, and the evolution of the AI content generation pipeline.

---

## 1. AI Generation Evolution: The Tool Registry (vs. Arbitrary MCPs)

### 1.1 The Vision
In V1, the AI generation pipeline is linear: Input $\rightarrow$ AI reads it $\rightarrow$ AI writes post. 
For V2, we want to give the AI "superpowers" to dynamically fetch missing context, search real-time news, or interact with external services to create hyper-relevant content.

### 1.2 The Strategy: Managed Tool Registry
Instead of allowing users to connect arbitrary, unvetted Model Context Protocol (MCP) servers (which introduces massive security risks, unpredictable latency, and boundless LLM token costs), V2 will implement a **Managed Tool Registry**.

*   **How it works:** We (the developers) pre-integrate highly vetted, secure tools into the Python Worker.
*   **Examples of Tools:**
    *   **Web Search:** (e.g., Tavily or Perplexity API) to search the web for the latest news on a given topic.
    *   **Scraping Tool:** A focused Playwright agent that can dynamically visit a mentioned URL to get more context if the initial prompt requires it.
    *   **Internal Knowledge Base:** A vector-database connection to the user's previously generated successful posts to mimic their style more accurately.
*   **User Experience (UI):** In the Chat/Generation UI, users see a simple list of toggles:
    *   $[x]$ Enable Live Web Search
    *   $[ ]$ Check latest trends on X
*   **Under the Hood:** When a user toggles a tool, the Python FastAPI worker passes that specific tool definition to the LLM (Groq/Gemini). The LLM operates as an **Autonomous Agent**, deciding if and when to call the tool before generating the final post.

### 1.3 Benefits of the Managed Approach
1.  **Security (No SSRF):** We control the outbound requests. Users cannot trick the AI into scanning our internal AWS/Vercel metadata or attacking third-party servers.
2.  **Cost Control:** Agentic loops can consume massive amounts of tokens. By tightly scoping the tools, we prevent runaway AI loops.
3.  **Reliability:** We can write robust tests (`pytest`) for our specific tools, which is impossible if users bring their own arbitrary MCP servers.

---

## 2. Infrastructure & Scaling

As the user base grows, the V1 infrastructure will need optimization to handle concurrent load and reduce API costs.

### 2.1 Upstash Redis Rate Limiting
*   **Current State (V1):** Database-backed rate limiting. Has a known race condition where simultaneous requests can bypass the limit.
*   **V2 Upgrade:** Implement `@upstash/ratelimit` with a sliding window algorithm. This moves rate-limiting to a highly concurrent, memory-fast Redis edge network, protecting our database from spike loads.

### 2.2 URL-Hash Ingestion Caching
*   **Current State (V1):** Every URL submitted is re-scraped via Playwright and re-uploaded/processed.
*   **V2 Upgrade:** Hash the incoming URL. Before triggering Playwright, check if that URL hash exists in the database from the last 7 days. If yes, instantly return the cached extracted text and Cloudinary assets. This will drastically cut down on expensive Playwright compute time and Cloudinary storage.

---

## 3. Resilience & Reliability

### 3.1 Publishing Retry Policy
*   **Current State (V1):** Fire-and-forget. If the LinkedIn or X API times out or throws a 500 error, the post is marked as `failed` and sits there.
*   **V2 Upgrade:** Implement an Exponential Backoff Retry queue for publishing.
    *   Attempt 1: Immediate.
    *   Attempt 2: Wait 5 minutes.
    *   Attempt 3: Wait 15 minutes.
    *   Attempt 4: Wait 60 minutes.
    *   *Implementation:* Expand the `cron` sweeping logic to select posts that are `failed` but have `retry_count < 3` and where `next_retry_at <= now()`.
