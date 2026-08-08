# Nomster

A real-time, two-device app for deciding where to eat: two people each swipe through a shared deck of nearby restaurants, and a match fires live on both screens the moment they both say yes. Built as a weekend project, hardened like it wasn't.

**Live:** https://nomster.ameeraqasyah.dev/

## Overview

Nomster solves a small, specific coordination problem — two people, one meal, no consensus — with a Tinder-style swipe interface backed by real restaurant data and real-time sync. No accounts, no app store install required (it's a installable PWA), no server to manage. A 4-letter room code and a shared link are the entire session model.

## Features

- Location-based restaurant discovery via the Google Places API (New), with cuisine and price filters
- Tinder-style swipe UI with drag gestures, card animations, and an animated match screen
- Real-time match detection and presence (who's joined the room) via Supabase Realtime, no polling
- Resilience: auto-reconnect on dropped realtime connections, resume-in-progress sessions on reload, retry-on-collision for room codes, and an "undo last swipe" affordance
- Installable as a home-screen PWA with a generated icon set
- A landing page for first-time visitors that's automatically skipped for anyone opening a shared invite link or returning to the app

## Tech stack

- **Frontend:** vanilla HTML/CSS/JS — no framework, no build step, no bundler. Deliberate: this is a small enough surface area that a framework would add overhead without adding clarity.
- **Backend:** [Supabase](https://supabase.com) (Postgres + Realtime) for data storage and live sync between the two devices.
- **Data:** [Google Places API (New)](https://developers.google.com/maps/documentation/places/web-service/op-overview) for restaurant search and photos.
- **Hosting:** GitHub Pages (static, no server to run or pay for).

## Architecture notes

**Realtime matching** — votes are written to a Postgres table; a Supabase Realtime subscription on that table lets each device react the instant the other person votes, without either device polling. A match is detected when a restaurant has two distinct yes-votes in the room, computed client-side against the live event stream.

**Cost and abuse hardening** — the interesting constraint on this project wasn't the swipe UI, it was that every "create a room" action costs real money against a paid third-party API, called directly from an unauthenticated client. That shaped several decisions: a per-device cooldown on room creation and on fetching additional restaurants, referrer-restricting the API key to the deployed domain, scoping the key to a single API rather than the full Google Cloud surface, and documenting the fact that some protections (a hard daily quota cap) aren't actually available through Google's self-service tools for this API tier — so the real defense is a combination of client-side rate-limiting, key scoping, and budget alerting, not any single control.

**No backend of its own** — there's no custom server. Supabase's row-level security policies (open read/write, scoped by room code) stand in for an auth layer, which is a deliberate trade for a two-person, low-stakes app — documented in the schema as a decision, not an oversight.

## Local setup

<details>
<summary>Expand for full setup instructions (Supabase + Google Cloud + hosting)</summary>

### 1. Supabase

1. Create a project at supabase.com.
2. **SQL Editor** → new query → paste in `schema.sql` → run it.
3. **Project Settings → Data API** → copy the **Project URL**.
4. **Project Settings → API Keys** → copy the **anon public** key (the JWT format — the CDN version of `supabase-js` this app loads expects that, not the newer `sb_publishable_...` format).
5. Confirm realtime is enabled: **Database → Replication** → `votes` should be listed under `supabase_realtime`.

### 2. Google Places API

1. Create a project at console.cloud.google.com.
2. Enable **Places API (New)**.
3. Enable billing (required by Google even within the free tier).
4. Create an API key under **Credentials**.
5. Restrict it: **Application restrictions → Websites** → your deployed domain. **API restrictions** → scope to Places API (New) only.
6. Set a budget alert under **Billing → Budgets & alerts**.

### 3. Config

Fill in the three constants at the top of `script.js`:

```js
const SUPABASE_URL = "...";
const SUPABASE_ANON_KEY = "...";
const GOOGLE_PLACES_API_KEY = "...";
```

### 4. Deploy

Push to a public GitHub repo, enable Pages under Settings → Pages, source: deploy from branch.

</details>

## Known limitations

No persistent accounts (device ID in localStorage is the identity). No match history across rooms. No ranking step when multiple mutual matches occur. Cuisine filtering depends on Google's Places type taxonomy and hasn't been exhaustively tested against every type string. These are scope decisions for a two-person weekend tool, not blind spots — documented rather than hidden.
