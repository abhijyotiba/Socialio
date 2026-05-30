# Growth Operator — Vision (captured, not yet scoped to build)

> **Status:** Idea captured 2026-05-30. NOT validated by user demand, NOT designed in detail, NOT planned.
> This is "Layer 2" from the Autonomous Content Engine brainstorm
> (`docs/superpowers/specs/2026-05-30-autonomous-content-engine-design.md` §4.5 reserved a seam for it).
> **Do not build until a real user asks for it.** Per `SOCIALOS_V2_PLAN.md` §6.6: every "client need" is a
> guess until validated against actual user pain. This one emerged in brainstorm as "interesting to have,"
> not as a stated need — so it waits.

---

## One-line pitch

The content engine gets you **posting**. The Growth Operator gets you **noticed** — by putting your voice in
the right conversations, in front of the right people, every day, without you having to hunt for them.

## The problem it solves

Posting content is only half of growth — the other half is **engagement**: showing up in *other people's*
conversations so the right audience discovers you. Doing that well is brutal manual labor (scroll for an hour
finding worthwhile posts, judge which deserve your voice, write an on-brand non-generic reply for each, repeat
*daily* or it doesn't work). Almost nobody sustains it. That's the gap.

## What it does (the value)

Every morning the platform hands the user a short, curated **action list** instead of an hour of doom-scrolling:

> "Here are 10 conversations in your niche worth your voice right now. For each, I've drafted an on-brand
> comment. Review, tweak, post."

The user spends ~10 focused minutes approving/posting. The machine did the exhausting 95% (find + judge +
draft); the human does the easy, safe 5% (the final click). **Value in three words: effortless, consistent,
daily engagement** — the thing that actually grows an audience and the thing people always quit doing.

## Versions (how it could grow)

| Version | What it does | Value |
|---|---|---|
| **V1 — Engagement Assistant** | Daily list of relevant conversations + drafted on-brand replies; user posts them. | Turns the #1 abandoned growth habit (consistent commenting) into a 10-min routine. |
| **V2 — Audience Targeting** | User names target accounts / topics / competitors; engine prioritizes conversations involving their ICP, not random ones. | Engagement aimed at the *right* people. |
| **V3 — Relationship Tracking** | Remembers who the user engaged with, nudges follow-ups, surfaces warm leads ("you've commented on 3 of her posts — time to connect"). | Turns scattered comments into relationships → DMs → leads. |

*Outbound flavor (reach NEW people who don't know you — mass-but-personalized outreach/DMs) is a related but
distinct direction, heaviest ToS risk, and was NOT what the user originally pictured. If pursued, scope it to
drafting + manual send only.*

---

## The non-negotiable constraint: ACTION MODEL = "assist, never act"

The machine does **Find + Decide + Draft**. The **human does Send**, from their own session. This is not a
watered-down compromise — for this product it is the *better and only safe* model. Reasoning:

- **LinkedIn offers ZERO sanctioned engagement/outreach API.** You cannot legally automate a single LinkedIn
  comment, connect, or DM. Automating it = browser-automation gray zone = bans. CLAUDE.md §B.11 already bans
  LinkedIn scraping for this exact reason.
- **X** has an API but basic-tier write limits + spam detection throttle/flag automated mass-engagement almost
  immediately (and the 17-tweet/day ceiling is already documented).
- **Multi-tenant auto-engagement is the exact pattern platforms hunt and ban en masse.** Automating sends
  across tenants makes every customer account a liability and SocialOS one platform-sweep from being the reason
  hundreds of accounts get banned.
- Even tools that DO automate (Expandi, Dux-Soup) self-cap at ~20 actions/day to avoid bans — so "full
  automation" isn't "unstoppable mass outreach," it's "a slow trickle that still sometimes gets you banned."
  Keeping the human on the send button gives up almost no real volume.

**Therefore: never automate account actions. SocialOS is the growth brain; the human is the hands.** This keeps
the product unkillable (a smart browser tab, not a bot farm).

## Honest cost / framing

Unlike the content engine (runs while you sleep), the Growth Operator is **NOT "set it once, never touch."**
It hands the user a daily action list they must show up and act on. Honest pitch: "spend 10 focused minutes a
day approving high-value engagements instead of doom-scrolling for an hour." Still a big win — just frame it
truthfully.

## Why it fits SocialOS (reuse)

It's **the content engine pointed outward.** Instead of "atomize *your* asset into posts," it's "read
*someone else's* post → draft a reply in your brand voice." Reuses:
- The brand-voice + versioned-prompt system (every draft is on-brand).
- The LLM adapter + concurrency semaphore.
- The approve-a-batch UX (the Review Queue pattern is nearly identical).
- The cron loop chassis (cron → check state → act → notify) — explicitly reserved as the Growth seam.

---

## The hard open question to resolve BEFORE any build: the data-acquisition problem

How do you even **find** relevant conversations without scraping?
- **X:** has a search/recent-tweets API — feasible within rate limits, but tiered/limited.
- **LinkedIn:** near-total lack of any search/discovery API. This may mean **V1 is X-only**, or that LinkedIn
  engagement is limited to "paste a post URL, get a drafted reply" (user-initiated, not auto-discovered).

This feasibility question (can we find conversations legally + affordably, per platform?) is the FIRST thing to
answer if/when this is picked up. It may constrain V1 to a single platform.

## When to revisit

- A real user (ideally a paying beta user) explicitly asks for engagement/growth help, OR
- The content engine has clear PMF and you're choosing the next big bet.

At that point: run a fresh brainstorm → start with the data-acquisition feasibility probe (X search API limits,
LinkedIn discovery options) → then design V1 (likely "Engagement Assistant," possibly X-only) → spec → plan.
