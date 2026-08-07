// ============ CONFIG — fill these in, see README.md ============
const SUPABASE_URL = "https://tvwffiiofoeqwvynguub.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2d2ZmaWlvZm9lcXd2eW5ndXViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwNzgyNDAsImV4cCI6MjEwMTY1NDI0MH0.H9ISTnxzl81jlMDFe3TGqjiL_zQR2AGle78pGxGAqDs";
const GOOGLE_PLACES_API_KEY = "AIzaSyA3eOSguuwLWqztpaPEmzY3oOWzivCfzbA";
const SEARCH_RADIUS_METERS = 3000;
const MAX_RESULTS = 20;
const ROOM_CREATE_COOLDOWN_MS = 60000; // min gap between room creations per device, caps accidental/abusive Places calls
// ==================================================================

const sb = (SUPABASE_URL.startsWith("http"))
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const screens = {};
document.querySelectorAll(".screen").forEach(el => screens[el.id] = el);
function showScreen(id){
  Object.values(screens).forEach(el => el.classList.remove("active"));
  screens[id].classList.add("active");
}
function toast(msg, ms=2500){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.style.display = "none", ms);
}

// ---- device identity ----
function getDeviceId(){
  let id = localStorage.getItem("fs_device_id");
  if (!id){
    id = "d_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("fs_device_id", id);
  }
  return id;
}
const deviceId = getDeviceId();
let nickname = localStorage.getItem("fs_nickname") || "";

// ---- room state ----
let roomCode = null;
let restaurants = [];      // full deck for this room
let deckQueue = [];        // remaining un-swiped cards for this device
let myVotes = {};          // restaurant_id -> bool
let matchedIds = new Set();
let channel = null;
let currentRoomLatLng = null;   // for "get more restaurants"
let lastSwipe = null;           // {restaurant, vote} for undo
let activeFilters = { includedTypes: ["restaurant"], maxPriceRank: null };
const PRICE_RANK = {
  PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4
};
const CUISINE_TYPES = {
  italian: "italian_restaurant", chinese: "chinese_restaurant",
  mexican: "mexican_restaurant", japanese: "japanese_restaurant",
  indian: "indian_restaurant", fastfood: "fast_food_restaurant", cafe: "cafe"
};
const GET_MORE_COOLDOWN_MS = 30000;

function mapPlaceToRow(p){
  return {
    place_id: p.id,
    name: p.displayName?.text || "Unknown",
    rating: p.rating || null,
    price_level: p.priceLevel || null,
    address: p.formattedAddress || "",
    maps_uri: p.googleMapsUri || "",
    photo_name: p.photos?.[0]?.name || null
  };
}
function filterByPrice(places, maxRank){
  if (maxRank == null) return places;
  return places.filter(p => !p.priceLevel || (PRICE_RANK[p.priceLevel] ?? 99) <= maxRank);
}

function config_ok(){
  return sb && GOOGLE_PLACES_API_KEY && GOOGLE_PLACES_API_KEY !== "YOUR_GOOGLE_PLACES_API_KEY";
}

// ---- boot ----
(function init(){
  if (!config_ok()){
    document.getElementById("start-err").textContent =
      "Config not set. Open index.html and fill in SUPABASE_URL, SUPABASE_ANON_KEY, and GOOGLE_PLACES_API_KEY at the top of the <script>, per README.md.";
  }
  if (nickname){
    document.getElementById("nickname-input").value = nickname;
  }
  const params = new URLSearchParams(window.location.search);
  const joinCode = params.get("room");
  document.getElementById("nickname-continue").onclick = () => {
    const v = document.getElementById("nickname-input").value.trim();
    if (!v){
      document.getElementById("nickname-err").textContent = "Enter a name.";
      return;
    }
    if (!config_ok()){
      document.getElementById("nickname-err").textContent =
        "Config not set. Fill in SUPABASE_URL, SUPABASE_ANON_KEY, and GOOGLE_PLACES_API_KEY in index.html first.";
      return;
    }
    nickname = v;
    localStorage.setItem("fs_nickname", nickname);
    const resumeCode = localStorage.getItem("fs_current_room");
    if (joinCode){
      joinRoom(joinCode.toUpperCase());
    } else if (resumeCode){
      enterRoom(resumeCode).catch(() => {
        localStorage.removeItem("fs_current_room");
        showScreen("screen-start");
      });
    } else {
      showScreen("screen-start");
    }
  };
})();

// ---- create room ----
async function createRoomWithRetries(lat, lng, attemptsLeft = 5){
  const code = Array.from({length:4}, () =>
    "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random()*24)]
  ).join("");
  const { error } = await sb.from("rooms").insert({ code, lat, lng });
  if (error){
    // 23505 = unique_violation (Postgres) — extremely unlikely with 24^4 codes, but retry rather than crash.
    if (error.code === "23505" && attemptsLeft > 0){
      return createRoomWithRetries(lat, lng, attemptsLeft - 1);
    }
    throw error;
  }
  return code;
}

function geolocationErrorMessage(err){
  if (err.code === 1) return "Location permission denied. Enable location for this site in your browser settings and try again.";
  if (err.code === 2) return "Couldn't determine your location (device reports it's unavailable). Try again, or move somewhere with better GPS/network signal.";
  if (err.code === 3) return "Location request timed out. Try again.";
  return "Couldn't get your location.";
}

document.getElementById("create-room-btn").onclick = async () => {
  if (!config_ok()) return;
  const btn = document.getElementById("create-room-btn");
  const errEl = document.getElementById("start-err");
  errEl.textContent = "";

  const lastCreate = Number(localStorage.getItem("fs_last_create") || 0);
  const waitMs = ROOM_CREATE_COOLDOWN_MS - (Date.now() - lastCreate);
  if (waitMs > 0){
    errEl.textContent = `Just made a room — wait ${Math.ceil(waitMs/1000)}s before creating another (keeps a stray click from burning API calls).`;
    return;
  }

  btn.disabled = true;
  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 })
    );
    const lat = pos.coords.latitude, lng = pos.coords.longitude;

    const cuisineKey = document.querySelector("#cuisine-chips .chip.selected")?.dataset.cuisine || "";
    const includedTypes = cuisineKey ? [CUISINE_TYPES[cuisineKey]] : ["restaurant"];
    const priceVal = document.getElementById("price-select").value;
    const maxPriceRank = priceVal ? Number(priceVal) : null;
    activeFilters = { includedTypes, maxPriceRank };

    let places = await fetchNearbyRestaurants(lat, lng, includedTypes);
    places = filterByPrice(places, maxPriceRank);
    if (!places.length) throw new Error("No restaurants found matching those filters nearby. Try loosening cuisine/price.");

    localStorage.setItem("fs_last_create", String(Date.now()));
    const code = await createRoomWithRetries(lat, lng);

    const rows = places.map(p => ({ ...mapPlaceToRow(p), room_code: code }));
    const { error: rErr } = await sb.from("restaurants").insert(rows);
    if (rErr) throw rErr;

    roomCode = code;
    currentRoomLatLng = { lat, lng };
    renderShareScreen(code);
    showScreen("screen-share");
  } catch (e) {
    console.error(e);
    if (e.code && typeof e.code === "number"){
      errEl.textContent = geolocationErrorMessage(e);
    } else {
      errEl.textContent = e.message || "Couldn't create room. Check your config values and try again.";
    }
  } finally {
    btn.disabled = false;
  }
};

function renderShareScreen(code){
  const link = `${window.location.origin}${window.location.pathname}?room=${code}`;
  document.getElementById("share-code").textContent = code;
  document.getElementById("share-link").textContent = link;
  document.getElementById("copy-link-btn").onclick = () => {
    navigator.clipboard.writeText(link);
    toast("Link copied");
  };
}
document.getElementById("start-swiping-btn").onclick = () => {
  if (roomCode) enterRoom(roomCode);
};
document.getElementById("invite-btn").onclick = () => {
  if (!roomCode) return;
  renderShareScreen(roomCode);
  showScreen("screen-share");
};

document.getElementById("cuisine-chips").addEventListener("click", e => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  document.querySelectorAll("#cuisine-chips .chip").forEach(c => c.classList.remove("selected"));
  chip.classList.add("selected");
});

document.getElementById("leave-room-btn").onclick = () => {
  if (channel){ sb.removeChannel(channel); channel = null; }
  localStorage.removeItem("fs_current_room");
  roomCode = null; restaurants = []; deckQueue = []; myVotes = {};
  matchedIds = new Set(); lastSwipe = null; currentRoomLatLng = null;
  document.getElementById("undo-btn").disabled = true;
  showScreen("screen-start");
};

async function undoLastSwipe(){
  if (!lastSwipe || !roomCode) return;
  const { restaurant } = lastSwipe;
  lastSwipe = null;
  document.getElementById("undo-btn").disabled = true;
  delete myVotes[restaurant.id];
  await sb.from("votes").delete()
    .eq("room_code", roomCode).eq("restaurant_id", restaurant.id).eq("device_id", deviceId);
  deckQueue.unshift(restaurant);
  renderDeck();
}
document.getElementById("undo-btn").onclick = undoLastSwipe;

document.getElementById("deck").addEventListener("click", e => {
  if (e.target.id === "get-more-btn") getMoreRestaurants();
});

async function getMoreRestaurants(){
  if (!currentRoomLatLng){ toast("Missing room location — can't fetch more."); return; }
  const last = Number(localStorage.getItem("fs_last_getmore") || 0);
  const wait = GET_MORE_COOLDOWN_MS - (Date.now() - last);
  if (wait > 0){ toast(`Wait ${Math.ceil(wait/1000)}s before fetching more.`); return; }
  try {
    let places = await fetchNearbyRestaurants(currentRoomLatLng.lat, currentRoomLatLng.lng, activeFilters.includedTypes);
    places = filterByPrice(places, activeFilters.maxPriceRank);
    const existingIds = new Set(restaurants.map(r => r.place_id));
    const fresh = places.filter(p => !existingIds.has(p.id));
    if (!fresh.length){ toast("No new places found nearby."); return; }
    localStorage.setItem("fs_last_getmore", String(Date.now()));
    const rows = fresh.map(p => ({ ...mapPlaceToRow(p), room_code: roomCode }));
    const { data, error } = await sb.from("restaurants").insert(rows).select();
    if (error) throw error;
    restaurants = restaurants.concat(data);
    deckQueue = deckQueue.concat(data);
    renderDeck();
    toast(`Added ${data.length} more`);
  } catch (e) {
    console.error(e);
    toast("Couldn't fetch more restaurants.");
  }
}

async function joinRoom(code){
  showScreen("screen-start");
  document.getElementById("start-err").textContent = "Joining room " + code + "...";
  const { data: room, error } = await sb.from("rooms").select("*").eq("code", code).single();
  if (error || !room){
    document.getElementById("start-err").textContent = "Room " + code + " not found. Ask for a fresh link.";
    return;
  }
  await enterRoom(code);
}

// ---- swipe deck ----
async function enterRoom(code){
  const { data: rs, error } = await sb.from("restaurants").select("*").eq("room_code", code);
  if (error || !rs || !rs.length){
    toast("Couldn't load that room — it may not exist.");
    throw error || new Error("empty room");
  }
  roomCode = code;
  localStorage.setItem("fs_current_room", code);
  document.getElementById("swipe-code").textContent = code;
  restaurants = rs;
  lastSwipe = null;
  document.getElementById("undo-btn").disabled = true;

  if (!currentRoomLatLng){
    const { data: roomRow } = await sb.from("rooms").select("lat,lng").eq("code", code).single();
    if (roomRow) currentRoomLatLng = { lat: roomRow.lat, lng: roomRow.lng };
  }

  const { data: existingVotes } = await sb.from("votes").select("*")
    .eq("room_code", code).eq("device_id", deviceId);
  (existingVotes || []).forEach(v => myVotes[v.restaurant_id] = v.vote);

  deckQueue = restaurants.filter(r => !(r.id in myVotes));
  subscribeToRoom(code);
  await refreshMatches(true);
  renderDeck();
  showScreen("screen-swipe");
}

function renderDeck(){
  const deck = document.getElementById("deck");
  deck.innerHTML = "";
  document.getElementById("swipe-progress").textContent =
    deckQueue.length ? `${deckQueue.length} left` : "";

  if (!deckQueue.length){
    deck.innerHTML = `<div class="empty">
      That's everyone. Check "View matches" for anything you both liked.<br><br>
      <button id="get-more-btn" class="secondary" style="width:auto;padding:10px 18px;">Get more restaurants</button>
    </div>`;
    return;
  }
  const r = deckQueue[0];
  const el = document.createElement("div");
  el.className = "rcard";
  const photoUrl = r.photo_name
    ? `https://places.googleapis.com/v1/${r.photo_name}/media?maxWidthPx=500&key=${GOOGLE_PLACES_API_KEY}`
    : null;
  el.innerHTML = `
    ${photoUrl ? `<img src="${photoUrl}" alt="">` : `<div class="noimg-fill"></div>`}
    <div class="photofade"></div>
    <div class="stamp like">Yes</div>
    <div class="stamp nope">No</div>
    <div class="body">
      <h3>${escapeHtml(r.name)}</h3>
      <div class="meta">
        ${r.rating ? `<span class="badge">★ ${r.rating}</span>` : ""}
        ${r.price_level ? `<span class="badge">${priceSymbol(r.price_level)}</span>` : ""}
      </div>
      <p class="addr">${escapeHtml(r.address || "")}</p>
    </div>`;
  deck.appendChild(el);
  attachDragHandlers(el);
}

function attachDragHandlers(el){
  const likeStamp = el.querySelector(".stamp.like");
  const nopeStamp = el.querySelector(".stamp.nope");
  const THRESHOLD = 100;
  let startX = 0, startY = 0, dx = 0, dragging = false, pointerId = null;

  function onDown(e){
    if (dragging) return;
    dragging = true;
    pointerId = e.pointerId;
    el.setPointerCapture(pointerId);
    startX = e.clientX; startY = e.clientY;
    el.style.transition = "none";
  }
  function onMove(e){
    if (!dragging) return;
    dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const rot = dx / 18;
    el.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
    const pct = Math.min(Math.abs(dx) / THRESHOLD, 1);
    if (dx > 0){ likeStamp.style.opacity = pct; nopeStamp.style.opacity = 0; }
    else { nopeStamp.style.opacity = pct; likeStamp.style.opacity = 0; }
  }
  function onUp(){
    if (!dragging) return;
    dragging = false;
    el.style.transition = "transform 0.3s ease";
    if (Math.abs(dx) > THRESHOLD){
      const dir = dx > 0 ? 1 : -1;
      el.style.transform = `translate(${dir * 700}px, ${dx * 0.2}px) rotate(${dir * 30}deg)`;
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      setTimeout(() => castVote(dir > 0), 260);
    } else {
      el.style.transform = "translate(0,0) rotate(0)";
      likeStamp.style.opacity = 0;
      nopeStamp.style.opacity = 0;
    }
    dx = 0;
  }
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
}

function priceSymbol(level){
  const map = {
    PRICE_LEVEL_FREE: "Free", PRICE_LEVEL_INEXPENSIVE: "$",
    PRICE_LEVEL_MODERATE: "$$", PRICE_LEVEL_EXPENSIVE: "$$$",
    PRICE_LEVEL_VERY_EXPENSIVE: "$$$$"
  };
  return map[level] || "";
}
function escapeHtml(s){
  return (s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

async function castVote(vote){
  if (!deckQueue.length) return;
  const r = deckQueue[0];
  myVotes[r.id] = vote;
  const { error } = await sb.from("votes").upsert({
    room_code: roomCode, restaurant_id: r.id, device_id: deviceId,
    nickname, vote
  }, { onConflict: "room_code,restaurant_id,device_id" });
  if (error) console.error(error);
  lastSwipe = { restaurant: r, vote };
  document.getElementById("undo-btn").disabled = false;
  deckQueue.shift();
  renderDeck();
}
document.getElementById("yes-btn").onclick = () => castVote(true);
document.getElementById("no-btn").onclick = () => castVote(false);

// ---- realtime matching ----
function updatePresenceUI(){
  const el = document.getElementById("presence-indicator");
  if (!el || !channel) return;
  const state = channel.presenceState();
  const others = new Set();
  Object.values(state).forEach(arr => arr.forEach(p => {
    if (p.device_id && p.device_id !== deviceId) others.add(p.nickname || "someone");
  }));
  el.innerHTML = others.size
    ? `<span class="dot"></span>With you: ${[...others].map(escapeHtml).join(", ")}`
    : `Waiting for the other person to open the link...`;
}

let reconnectAttempts = 0;
function subscribeToRoom(code){
  if (channel) sb.removeChannel(channel);
  channel = sb.channel("room-" + code)
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "votes",
      filter: `room_code=eq.${code}`
    }, payload => {
      if (payload.new.vote) checkMatch(payload.new.restaurant_id);
    })
    .on("presence", { event: "sync" }, () => updatePresenceUI())
    .subscribe(status => {
      if (status === "SUBSCRIBED"){
        reconnectAttempts = 0;
        channel.track({ nickname, device_id: deviceId });
        // catch up on anything that happened while disconnected/reconnecting
        refreshMatches(true).then(() => renderMatchesList());
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED"){
        reconnectAttempts++;
        toast("Connection dropped — reconnecting...");
        if (reconnectAttempts <= 5){
          setTimeout(() => { if (roomCode === code) subscribeToRoom(code); }, 2000 * reconnectAttempts);
        } else {
          toast("Can't reconnect. Matches from the other person won't show live — reopen the link to refresh.");
        }
      }
    });
}

async function checkMatch(restaurantId){
  if (matchedIds.has(restaurantId)) return;
  const { data: yesVotes } = await sb.from("votes").select("device_id")
    .eq("room_code", roomCode).eq("restaurant_id", restaurantId).eq("vote", true);
  const distinctDevices = new Set((yesVotes || []).map(v => v.device_id));
  if (distinctDevices.size >= 2){
    matchedIds.add(restaurantId);
    const r = restaurants.find(x => x.id === restaurantId);
    if (r) showMatch(r);
  }
}

async function refreshMatches(silent){
  // catch up on matches that happened before this device subscribed
  const { data: votes } = await sb.from("votes").select("restaurant_id, device_id, vote")
    .eq("room_code", roomCode).eq("vote", true);
  const byRestaurant = {};
  (votes || []).forEach(v => {
    byRestaurant[v.restaurant_id] = byRestaurant[v.restaurant_id] || new Set();
    byRestaurant[v.restaurant_id].add(v.device_id);
  });
  Object.entries(byRestaurant).forEach(([rid, devices]) => {
    if (devices.size >= 2) matchedIds.add(rid);
  });
  if (!silent) renderMatchesList();
}

function spawnConfetti(){
  const pieces = ["🎉","🍕","🍔","🌮","🍜","😋","🍩"];
  for (let i = 0; i < 18; i++){
    const el = document.createElement("div");
    el.className = "confetti";
    el.textContent = pieces[Math.floor(Math.random() * pieces.length)];
    el.style.left = Math.random() * 100 + "vw";
    el.style.animationDuration = (1.8 + Math.random() * 1.4) + "s";
    el.style.animationDelay = (Math.random() * 0.4) + "s";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }
}

function showMatch(r){
  document.getElementById("match-name").textContent = r.name;
  document.getElementById("match-meta").textContent = r.address || "";
  document.getElementById("match-maps-link").href = r.maps_uri ||
    `https://www.google.com/maps/place/?q=place_id:${r.place_id}`;
  document.getElementById("match-overlay").classList.add("active");
  spawnConfetti();
}
document.getElementById("match-dismiss-btn").onclick = () => {
  document.getElementById("match-overlay").classList.remove("active");
};

document.getElementById("view-matches-btn").onclick = async () => {
  await refreshMatches();
  renderMatchesList();
  showScreen("screen-matches");
};
document.getElementById("back-to-swipe-btn").onclick = () => showScreen("screen-swipe");

function renderMatchesList(){
  const el = document.getElementById("matches-list");
  const matched = restaurants.filter(r => matchedIds.has(r.id));
  if (!matched.length){
    el.innerHTML = `<div class="empty">No matches yet. Keep swiping.</div>`;
    return;
  }
  el.innerHTML = matched.map(r => `
    <div class="card">
      <h3 style="margin:0 0 4px;">${escapeHtml(r.name)}</h3>
      <p class="muted" style="margin:0 0 8px;">${escapeHtml(r.address || "")}</p>
      <a href="${r.maps_uri || `https://www.google.com/maps/place/?q=place_id:${r.place_id}`}" target="_blank">Open in Google Maps</a>
    </div>
  `).join("");
}

// ---- Google Places (New) — Nearby Search ----
async function fetchNearbyRestaurants(lat, lng, includedTypes){
  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": [
        "places.id", "places.displayName", "places.rating",
        "places.priceLevel", "places.formattedAddress",
        "places.googleMapsUri", "places.photos"
      ].join(",")
    },
    body: JSON.stringify({
      includedTypes: includedTypes && includedTypes.length ? includedTypes : ["restaurant"],
      maxResultCount: MAX_RESULTS,
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius: SEARCH_RADIUS_METERS }
      }
    })
  });
  if (!res.ok){
    const body = await res.text();
    let hint = "";
    if (res.status === 403 || /API_KEY_INVALID|PERMISSION_DENIED/.test(body)){
      hint = " — check the key is correct and \"Places API (New)\" is enabled (not just the old Places API).";
    } else if (/BILLING/i.test(body)){
      hint = " — billing isn't enabled on this Google Cloud project yet.";
    } else if (res.status === 429 || /RESOURCE_EXHAUSTED/.test(body)){
      hint = " — you've hit a quota limit. If you set one intentionally, this is it working as designed.";
    }
    throw new Error(`Places API error (${res.status})${hint}`);
  }
  const data = await res.json();
  return data.places || [];
}
