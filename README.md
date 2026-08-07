# what should we eat

Two phones, one shared deck of nearby restaurants, swipe yes/no, matches show up live on both. Single-file app (`index.html`) + a small Supabase backend. No accounts — a 4-letter room code is the whole auth model.

## Setup (do this once, ~30-45 min, mostly the Google Cloud part)

### 1. Supabase (free)

1. Create a project at supabase.com.
2. Open **SQL Editor** → new query → paste in `schema.sql` → run it.
3. Go to **Project Settings → Data API** and copy your **Project URL**.
4. Go to **Project Settings → API Keys** and copy the **anon public** key.
5. Confirm realtime is on: **Database → Replication** → `votes` table should be listed under `supabase_realtime`. The schema script tries to add it automatically; if that line errored (because it's already there), you're fine.

### 2. Google Places API (the annoying part — do this first, not last)

1. Go to console.cloud.google.com, create a project.
2. **APIs & Services → Library** → enable **"Places API (New)"**.
3. You'll be prompted to enable billing. This requires a card on file, but Google gives $200/month free credit and a weekend of casual swiping won't come close to using it.
4. **APIs & Services → Credentials** → Create API key.
5. For now, leave it unrestricted so local testing works. Once you've deployed to a real URL, come back and restrict the key to that domain under **Application restrictions → HTTP referrers** — an unrestricted Places key in client-side code is a real risk if it leaks.
6. **Do this too, it's the part that actually caps your bill:** referrer restriction stops other sites from using your key, but it doesn't cap how much *this* app can spend if something goes wrong (bug, bot finds the URL, you fat-finger the create-room button 200 times). Go to **APIs & Services → Quotas & System Limits**, search "Places API (New)", find the daily request quota, and edit it down to something like 500/day. That's a hard server-side stop — nothing client-side (including anything in this app's code) can guarantee that the same way. Also set a budget alert under **Billing → Budgets & alerts** (e.g. $5) so you get a heads-up, separately from the hard cap.

### 3. Fill in config

Open `index.html`, find this block near the top of the `<script>` tag:

```js
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
const GOOGLE_PLACES_API_KEY = "YOUR_GOOGLE_PLACES_API_KEY";
```

Paste in your three values.

### 4. Host it somewhere reachable by both phones

`file://` won't work since two separate devices need to load the same URL. Fastest options:

- **Netlify Drop** (netlify.com/drop) — drag the folder in, get a live URL in seconds, no account needed. Best for a quick weekend test.
- **GitHub Pages** — same pattern as your `portfolio` folder: new repo, push, enable Pages. More permanent if you want to keep using this.

## Using it

1. Open the link, enter your name.
2. Person A: "Use my location & create a room" → grants location → app pulls ~20 nearby restaurants → get a room code + link.
3. Send the link to Person B (text, whatever). They open it, enter their name, land straight in the same deck.
4. Both swipe. Any restaurant you both swipe yes on triggers a match screen on both phones in real time, with a link to open it in Google Maps.
5. "View matches" shows everything you've both liked so far, in case you want a backup option.

## What's intentionally not built (cut for scope)

No filters (price/cuisine/radius — radius is fixed in the config constants if you want to change it). No photo galleries beyond the one photo Places returns. No persistent accounts — a device ID in localStorage is your identity, so a new browser/device means a fresh identity. No match history across rooms — each room is a self-contained session.

## What's hardened, and what still needs you

Built into the code: a per-device 60-second cooldown on room creation (stops a stray double-click from burning API calls), retry-on-collision for room codes, specific error messages for denied location / bad API key / billing-not-enabled / quota-hit instead of generic failures, auto-resume if you reload mid-session, a `noindex` tag + `robots.txt` so search engines don't crawl and accidentally trigger Places calls, and reconnect handling if the realtime connection drops.

What code can't do for you: cap your actual Google Cloud bill. Referrer restriction and the daily quota limit (step 2.6 above) are the real stop — set both before sharing the link with anyone. Also can't fully hide the Places key from anyone who opens dev tools on the live page — that's inherent to any client-only app calling a paid API directly, not something specific to this build.

## Known rough edges

If a room's location is wrong, it's because whoever created it either denied location permission or was somewhere unexpected — there's no manual address entry in v1. If the two of you are in very different network conditions (bad signal, VPN), the realtime match might take a few seconds to catch up — it retries automatically but isn't instant on a bad connection.
