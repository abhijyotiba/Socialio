# Cron Pinger Setup

SocialOS uses an **external scheduler** to drive the worker's background jobs.
The worker exposes `/cron/*` endpoints — there is no in-process scheduler (no
Celery, no APScheduler). You need an external service to call these endpoints on
a schedule.

All cron endpoints require the `Authorization: Bearer <CRON_SECRET>` header
where `CRON_SECRET` is the value of the `CRON_SECRET` env var set on the worker.

## Health Check

```
GET /cron/health
→ 200 {"status": "ok"}
```

Use this to monitor worker uptime. If your pinger supports it, alert on
non-200 responses.

## Endpoints & Recommended Cadences

| Endpoint | Method | Cadence | Purpose |
|---|---|---|---|
| `/cron/publish-due` | POST | **Every 5 minutes** | Publishes scheduled posts whose time has come. Also handles retry (re-claims `failed` rows with due `next_retry_at`), zombie campaign cleanup, and stuck-row sweeps. **This is the most critical endpoint** — if it stops, scheduled posts don't go out and retry never fires. |
| `/cron/refill-and-schedule` | POST | **Every 15 minutes** | Drains the content reservoir: renders planned cells into real posts and schedules them. Also fires low-reservoir nudges. |
| `/cron/token-expiry-check` | POST | **Every 6 hours** | Proactively refreshes OAuth tokens nearing expiry (within 7 days). Flags connections that need manual re-auth. |
| `/cron/pull-metrics` | POST | **Every 4 hours** | Pulls engagement metrics (impressions, likes, comments, shares) from LinkedIn and X for published posts. |
| `/cron/cleanup-orphaned-media` | POST | **Daily** | Deletes Cloudinary media assets no longer referenced by any post. Frees storage. |

## Setup: cron-job.org (Free Tier — Recommended)

[cron-job.org](https://cron-job.org) is a free external cron service. No account
needed for basic use.

For each endpoint:

1. Go to https://console.cron-job.org and create a new cronjob.
2. Set the **URL** to `https://<your-worker-host>/cron/<endpoint>`.
   - Example: `https://socialos-worker.fly.dev/cron/publish-due`
3. Set **Method** to `POST`.
4. Add a **Header**:
   - Name: `Authorization`
   - Value: `Bearer <your-cron-secret>`
5. Set the schedule (see cadences above).
6. Enable failure notifications so you know if the worker is down.

## Alternative: UptimeRobot

[UptimeRobot](https://uptimerobot.com) can double as a cron pinger for the
critical endpoints (publish-due, refill-and-schedule). Use the HTTP(s) monitor
type with the POST method and custom headers. The free tier supports 50 monitors.

## Redundancy

Use **two independent pingers** for the critical endpoints:

- `publish-due`: cron-job.org + UptimeRobot
- `refill-and-schedule`: cron-job.org + UptimeRobot

If one pinger goes down, the other keeps the autonomous engine running. The
endpoints are idempotent — calling them twice in the same minute is harmless.

## Troubleshooting

| Response | Meaning |
|---|---|
| `200` | Success. |
| `401 Unauthorized` | `CRON_SECRET` mismatch or missing `Authorization` header. Check the pinger's header value matches the worker's `CRON_SECRET` env var. |
| `404 Not Found` | Wrong URL. Verify the worker host and path. |
| `500 Internal Server Error` | Worker crashed or DB is unreachable. Check worker logs. |
| Pinger timeout | Worker is down or severely overloaded. Check the `/cron/health` endpoint. |

## Local Development

In local dev, you can trigger cron jobs manually:

```bash
curl -X POST http://localhost:8000/cron/publish-due \
  -H "Authorization: Bearer $CRON_SECRET"

curl -X POST http://localhost:8000/cron/refill-and-schedule \
  -H "Authorization: Bearer $CRON_SECRET"
```
