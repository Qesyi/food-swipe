# Nomster

Two phones, one shared deck of nearby restaurants, swipe yes/no, matches show up live on both. A landing screen introduces the app on first visit; returning users and anyone opening a shared invite link skip straight past it. Static site (`index.html` + `style.css` + `script.js`) + a small Supabase backend. No accounts — a 4-letter room code is the whole auth model.

## Files

- `index.html` — markup only
- `style.css` — light color theme (warm cream/orange), all component styling
- `script.js` — app logic, including the config block at the top
- `manifest.json` + `icons/` — PWA icon set so "Add to Home Screen" gets a real icon
- `schema.sql` — run once in Supabase's SQL editor
- `robots.txt` — blocks search engine crawling (this app should stay unlisted)

## Setup (do this once, ~30-45 min, mostly the Google Cloud part)

### 1. Supabase (free)

1. Create a project at supabase.com.
2. Open **SQL Editor** → new query → paste in `schema.sql` → run it.
3. Go to **Project Settings → Data API** and copy your **Project URL**.
4. Go to **Project Settings → API Keys** and copy the **anon public** key (the long JWT one, not the newer `sb_publishable_...` format — the CDN version of `supabase-js` this app loads expects the JWT).
5. Confirm realtime is on: **Database → Replication** → `votes` table should be listed under `supabase_realtime`. The schema script tries to add it automatically; if that line errored (because it's already there), you're fine.

### 2. Google Places API (the annoying part — do this first, not last)

1. Go to console.cloud.google.com, create a project.
2. **APIs & Services → Library** (or the Maps Platform-specific console) → enable **"Places API (New)"**.
3. You'll be prompted to enable billing. This requires a card on file, but Google gives a large free trial credit and casual two-person swiping won't come close to using it.
4. **APIs & Services → Credentials** → Create API key.
5. Restrict it: **Application restrictions → Websites** → add your live domain (e.g. `https://yourname.github.io/*`). Also set **API restrictions → Restrict key** → check only **Places API (New)**, uncheck everything else — limits the blast radius even if the referrer check is ever bypassed.
6. Set a budget alert: **Billing → Budgets & alerts** → new budget → a small amount (e.g. $5-20) → default alert thresholds. This is a notification, not a hard stop — Google doesn't allow self-service hard caps on the Nearby Search quota (its "Edit quota" option is greyed out on the free tier), so referrer + API restriction plus this app's own rate-limiting (below) are the real defenses.

### 3. Fill in config

Open `script.js`, find this block near the top:

```js
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
const GOOGLE_PLACES_API_KEY = "YOUR_GOOGLE_PLACES_API_KEY";
```

Paste in your three values. Note: these ship in plain text to the browser — that's inherent to any client-only app calling a paid API directly, not something specific to this build. Referrer restriction (step 2.5) is what actually protects you, not hiding the key.

### 4. Host it somewhere reachable by both phones

`file://` won't work since two separate devices need to load the same URL. This app is set up for **GitHub Pages**: push the folder to a public repo, enable Pages under Settings, and your URL will be `https://yourname.github.io/reponame/`.

## Using it

1. First-time visitors land on the intro screen (logo, tagline, three-step explainer) and tap "Get started." Anyone opening a shared room link, or anyone who's used the app on that device before, skips straight past it.
2. Enter a name.
3. Person A: optionally pick a cuisine chip and max price, then "Use my location & create a room" → grants location → app pulls nearby restaurants → get a room code + shareable link.
4. Send the link to Person B. They open it, enter their name, land straight in the same deck.
5. Both swipe (drag the card, or use the ✕/♥ buttons). Any restaurant you both swipe yes on triggers an animated match screen with confetti, on both phones in real time, with a link to open it in Google Maps.
6. If you run out of cards without a match, "Get more restaurants" fetches a fresh batch instead of dead-ending.
7. Misswiped? The ↺ button undoes your last swipe.
8. "Invite" (on the swipe screen) gets you back to the share/copy-link screen if you need to resend it. "Leave room" (on the Matches screen) resets everything and sends you back to start.
9. A small indicator above the deck shows whether the other person has joined yet.

## What's hardened, and what still needs you

Built into the code: a per-device 60-second cooldown on room creation and a 30-second cooldown on "get more restaurants" (stops stray clicks from burning API calls), retry-on-collision for room codes, specific error messages for denied location / bad API key / billing-not-enabled / quota-hit instead of generic failures, auto-resume if you reload mid-session, a `noindex` tag + `robots.txt` so search engines don't crawl and accidentally trigger Places calls, and reconnect handling if the realtime connection drops.

What code can't do for you: cap your actual Google Cloud bill with certainty. Referrer restriction, API restriction, and the budget alert (step 2 above) are the real defenses — set all three before sharing the link with anyone. Also can't fully hide the Places key from anyone who opens dev tools on the live page — inherent to any client-only app, not a bug in this one.

## What's intentionally not built (cut for scope)

No persistent accounts — a device ID in localStorage is your identity, so a new browser/device means a fresh identity. No match history across rooms — each room is a self-contained session. No ranking step when there are multiple mutual matches (first one shown wins the celebration, but "View matches" lists all of them). No one-tap call/order shortcuts.

## Known rough edges

If a room's location is wrong, it's because whoever created it either denied location permission or was somewhere unexpected — there's no manual address entry. Cuisine filtering relies on Google's Places API (New) type strings (`italian_restaurant`, `chinese_restaurant`, etc.) — untested against the live API from outside a normal browser session, so if a specific cuisine filter returns nothing or errors, that's worth reporting. If the two of you are in very different network conditions (bad signal, VPN), the realtime match might take a few seconds to catch up — it retries automatically but isn't instant on a bad connection.
