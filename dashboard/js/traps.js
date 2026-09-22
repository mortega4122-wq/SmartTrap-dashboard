// Shared trap logic for the map page, the phone view, the trap detail page, and
// orchard setup, so they all load, describe, and draw traps the same way.
// Load after js/auth.js (which provides SUPABASE_URL and authHeaders()).

const ARCGIS_KEY          = "AAPTaVBgWcwmkBkx6iqYw7uXtbQ..Osa6s3wYR1qeRc-FHJv-7xo0qGUcE_UXWBIy5Ugb6hg_DkQRKOfWMrceCvMXt_LcWmXGYoruj5TTc-rTFi58dvkeNDUw28EyxSIBq89chY_-NSW5X56boL-xg2Ikb_NuX21QzxzD4YW8w8bMDICciDZZhbfEfFdyNbrImabIrcBz3oqucBTAdiVVBM9eS9m1APnBewxY5p_D2w-KBJ0LWZyd5qqKXj6L_mqQf-5ebYhe-DILAguQGpyAAT1_EKuxh5JG";
const IMAGERY_URL         = `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${ARCGIS_KEY}`;
const IMAGERY_ATTRIBUTION = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>';
const DEFAULT_CENTER      = [37.35368, -120.93426];
const WIFI_RADIUS_METERS  = 30;

// ── Text helpers ─────────────────────────────────────────
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const cToF = c => (c * 9 / 5) + 32;

// "6:17 AM today", "yesterday 6:17 AM", "Mon 6:17 AM", or "Sep 12".
function formatWhen(date, now = new Date()) {
  if (!date) return "—";
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day  = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86400000);
  if (days === 0) return `${time} today`;
  if (days === 1) return `yesterday ${time}`;
  if (days > 1 && days < 7) return `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Trailing number of a trap ID, used as its map label ("demo-05" → "5").
function trapNumber(id, fallback) {
  const m = String(id).match(/(\d+)$/);
  return m ? String(parseInt(m[1], 10)) : String(fallback ?? "?");
}

// ── Supabase reads ───────────────────────────────────────
async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Supabase returned ${res.status}`);
  return res.json();
}

// Returns the raw Response so callers can tell 409 from 404 from a network error.
// "return=minimal" means a POST does NOT hand back the new row's id: re-read the
// table after an insert rather than assuming you have one.
async function sbWrite(path, method, body, extra = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { ...(await authHeaders()), "Content-Type": "application/json", "Prefer": "return=minimal", ...extra },
    body: JSON.stringify(body)
  });
}

// { node_id: [lat, lng] }, the order Leaflet expects, or null when the row has no coordinates.
async function fetchNodeLocations() {
  const rows = await sbGet("node_locations?select=node_id,latitude,longitude");
  const out  = {};
  if (Array.isArray(rows)) rows.forEach(r => {
    const lat = parseFloat(r.latitude), lng = parseFloat(r.longitude);
    out[r.node_id] = Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
  });
  return out;
}

// The account's orchard boundary, as orchard-setup.html saves it. The app uses a
// single boundary per account, so this takes the oldest row and ignores the rest.
async function fetchBoundaryRow() {
  const rows = await sbGet("orchard_boundaries?select=id,polygon_points&order=id.asc&limit=1");
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

// [[lat, lng], ...] in the order Leaflet expects, or [] when there's no usable
// boundary. Older rows stored {latitude, longitude} instead of {lat, lng}.
function boundaryPoints(row) {
  const pts = row && row.polygon_points;
  if (!Array.isArray(pts) || pts.length < 3) return [];
  return pts.map(p => [p.lat ?? p.latitude, p.lng ?? p.longitude]);
}

async function fetchRoverHistory() {
  const rows = await sbGet("rover_location?select=latitude,longitude,timestamp&order=id.asc");
  return Array.isArray(rows) ? rows : [];
}

// Beetles in a trap: entries minus exits across ALL beetle events. A separate query,
// so the row limits on the sensor queries don't cut off older detections.
async function fetchInsectCount(nodeId) {
  const rows = await sbGet(`trap_data?node_id=eq.${encodeURIComponent(nodeId)}&event_type=in.(beetle_count_added,beetle_count_removed)&select=event_type`);
  return Array.isArray(rows) ? rows.reduce((n, r) => n + (r.event_type === "beetle_count_added" ? 1 : -1), 0) : 0;
}

async function fetchNearestCity(lat, lng) {
  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, { headers: { "Accept-Language": "en-US,en" } });
    const addr = (await res.json()).address || {};
    const place = addr.town || addr.village || addr.city || addr.county || null;
    const state = addr.state_code || addr.state || "";
    const abbr  = state.length > 2 ? state.slice(0, 2).toUpperCase() : state.toUpperCase();
    return place ? `${place}, ${abbr}` : null;
  } catch { return null; }
}

// ── Reporting status ─────────────────────────────────────
// Traps upload when the rover passes, not continuously, so "has it reported
// lately" means "did it report on the rover's last pass".
const PASS_GAP_MS      = 2 * 60 * 60 * 1000;   // a longer gap between pings starts a new pass
const PASS_DONE_MS     = 60 * 60 * 1000;       // a pass is over once the rover is quiet this long
const NO_ROVER_OVERDUE = 26 * 60 * 60 * 1000;  // without rover data, flag a day-plus of silence

function roverPasses(pings) {
  const passes = [];
  pings.forEach(p => {
    const t = new Date(p.timestamp);
    const last = passes[passes.length - 1];
    if (last && t - last.end <= PASS_GAP_MS) last.end = t;
    else passes.push({ start: t, end: t });
  });
  return passes;
}

// The pass every trap should have reported on. While the rover is still out,
// that's the previous pass, so traps later on the route aren't flagged early.
function referencePassStart(pings, now = new Date()) {
  const passes = roverPasses(pings);
  if (passes.length === 0) return null;
  const latest = passes[passes.length - 1];
  if (now - latest.end >= PASS_DONE_MS) return latest.start;
  return passes.length > 1 ? passes[passes.length - 2].start : null;
}

function trapStatus(lastReport, pings, now = new Date()) {
  if (!lastReport) return { kind: "none", text: "No reports yet" };
  const ref    = pings.length ? referencePassStart(pings, now) : null;
  const missed = pings.length ? (ref !== null && lastReport < ref) : (now - lastReport > NO_ROVER_OVERDUE);
  if (missed) {
    return {
      kind: "missed",
      text: pings.length ? "Missed last pass" : "Overdue",
      detail: `Last report ${formatWhen(lastReport, now)}`
    };
  }
  return { kind: "ok", text: `Reported ${formatWhen(lastReport, now)}` };
}

function statusHTML(status) {
  const cls = status.kind === "missed" ? " is-missed" : status.kind === "none" ? " is-none" : "";
  return `<span class="status${cls}">${esc(status.text)}</span>`;
}

// ── Loading traps ────────────────────────────────────────
async function loadTrap(id, coords, pings) {
  const [rows, beetles] = await Promise.all([
    sbGet(`trap_data?node_id=eq.${encodeURIComponent(id)}&order=upload_timestamp.desc&limit=200`),
    fetchInsectCount(id)
  ]);
  const hasData = Array.isArray(rows) && rows.length > 0;
  const latest  = type => hasData ? rows.find(r => r.event_type === type && r.event_value !== null) : null;
  const temp = latest("temp"), hum = latest("humidity"), top = hasData ? rows[0] : null;
  const battRaw = top ? parseFloat(top.battery_voltage) : NaN;
  const lastReport = top?.upload_timestamp ? new Date(top.upload_timestamp) : null;
  return {
    id, coords, hasData,
    beetles:  hasData ? beetles : null,
    tempF:    temp ? cToF(parseFloat(temp.event_value)) : null,
    humidity: hum  ? parseFloat(hum.event_value)        : null,
    battery:  battRaw > 0 ? battRaw : null,
    rssi:     top && top.signal_strength_rssi !== null ? top.signal_strength_rssi : null,
    lastReport,
    status: trapStatus(lastReport, pings)
  };
}

// Every registered trap with its latest readings, in ID order, plus the rover pings.
async function loadTraps() {
  const [locations, pings] = await Promise.all([fetchNodeLocations(), fetchRoverHistory()]);
  const ids   = Object.keys(locations).sort();
  const traps = await Promise.all(ids.map(id => loadTrap(id, locations[id] || null, pings)));
  return { traps, pings };
}

function summarize(traps) {
  const avg = vals => vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const temps = traps.map(t => t.tempF).filter(v => v !== null);
  const hums  = traps.map(t => t.humidity).filter(v => v !== null);
  return {
    total:    traps.length,
    reported: traps.filter(t => t.status.kind === "ok").length,
    beetles:  traps.reduce((n, t) => n + (t.beetles || 0), 0),
    avgTemp:  avg(temps),
    avgHum:   avg(hums)
  };
}

// ── Rendering: sidebar ───────────────────────────────────
function summaryHTML(s) {
  const val = (v, unit, digits = 1) => v === null ? "—" : `${v.toFixed(digits)}<small>${unit}</small>`;
  return `
    <div class="stat-grid">
      <div class="stat"><div class="stat-value">${s.beetles}</div><div class="label"><span class="swatch swatch-beetles"></span>Beetles caught</div></div>
      <div class="stat"><div class="stat-value">${s.reported}<small>of ${s.total}</small></div><div class="label">Reported on last pass</div></div>
      <div class="stat"><div class="stat-value">${val(s.avgTemp, "°F")}</div><div class="label"><span class="swatch swatch-temp"></span>Avg temperature</div></div>
      <div class="stat"><div class="stat-value">${val(s.avgHum, "%")}</div><div class="label"><span class="swatch swatch-humidity"></span>Avg humidity</div></div>
    </div>`;
}

function trapCardHTML(t) {
  const reading = (v, unit, digits) => v === null ? "—" : `${v.toFixed(digits)}<small>${unit}</small>`;
  const power = [
    t.battery !== null ? `${t.battery.toFixed(2)} V` : "Battery not wired",
    t.rssi !== null ? `signal ${String(t.rssi).replace("-", "−")} dBm` : null
  ].filter(Boolean).join(" · ");
  return `
    <a class="trap-card" href="detail.html?node=${encodeURIComponent(t.id)}" data-trap="${esc(t.id)}">
      <div class="trap-card-top"><span class="trap-id">${esc(t.id)}</span>${statusHTML(t.status)}</div>
      ${t.status.detail ? `<div class="trap-card-sub">${esc(t.status.detail)}</div>` : ""}
      <div class="trap-card-main">
        <div class="reading reading-lead"><div class="reading-value">${t.beetles === null ? "—" : t.beetles}</div><div class="label"><span class="swatch swatch-beetles"></span>Beetles</div></div>
        <div class="reading"><div class="reading-value">${reading(t.tempF, "°F", 1)}</div><div class="label">Temp</div></div>
        <div class="reading"><div class="reading-value">${reading(t.humidity, "%", 1)}</div><div class="label">Humidity</div></div>
      </div>
      ${t.coords ? "" : `<p class="warn-note">No location set. Add it on the trap page.</p>`}
      <div class="trap-card-foot"><span>${esc(power)}</span><svg class="open" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></div>
    </a>`;
}

function skeletonCardsHTML(n = 3) {
  const card = `<div class="trap-card is-skeleton" aria-hidden="true"><span class="skeleton-bar" style="width:40%"></span><span class="skeleton-bar" style="width:85%;height:28px"></span><span class="skeleton-bar" style="width:60%"></span></div>`;
  return card.repeat(n);
}

function roverSeenText(pings) {
  if (!pings.length) return "No rover data yet";
  return `Rover last seen ${formatWhen(new Date(pings[pings.length - 1].timestamp))}`;
}

// ── Rendering: map ───────────────────────────────────────
function addImagery(map) {
  L.tileLayer(IMAGERY_URL, { attribution: IMAGERY_ATTRIBUTION, maxZoom: 20 }).addTo(map);
}

// A square trap pin. With `value`, it becomes a chip showing that value in its scale color.
function trapPinIcon(label, opts = {}) {
  const cls = ["pin"];
  if (opts.missed) cls.push("is-missed");
  if (opts.value !== undefined) cls.push("is-value");
  if (opts.hot) cls.push("is-hot");
  if (opts.plan) cls.push("is-plan");           // planned, not installed yet
  if (opts.repeater) cls.push("is-repeater");
  const style = opts.fill ? ` style="background:${opts.fill};color:${opts.ink}"` : "";
  const text  = opts.value !== undefined ? opts.value : label;
  return L.divIcon({ className: "map-anchor", html: `<div class="${cls.join(" ")}"${style}>${esc(text)}</div>`, iconSize: [0, 0], popupAnchor: [0, -16] });
}

function roverIcon(isLatest) {
  return L.divIcon({ className: "map-anchor", html: `<div class="rover-mark${isLatest ? "" : " is-past"}"></div>`, iconSize: [0, 0], popupAnchor: [0, -10] });
}

function trapPopupHTML(t) {
  const row = (name, v) => `<dt>${name}</dt><dd>${v}</dd>`;
  return `
    <div class="pop">
      <div class="pop-title">${esc(t.id)}</div>
      <div class="pop-status">${statusHTML(t.status)}</div>
      <dl>
        ${row("Beetles", t.beetles === null ? "—" : t.beetles)}
        ${row("Temp", t.tempF === null ? "—" : `${t.tempF.toFixed(1)} °F`)}
        ${row("Humidity", t.humidity === null ? "—" : `${t.humidity.toFixed(1)} %`)}
      </dl>
      <a class="pop-link" href="detail.html?node=${encodeURIComponent(t.id)}">Open trap</a>
    </div>`;
}

// Route, Wi-Fi range, and position of the rover's latest pings. Route and rings are
// white with a dark casing so they read on imagery and on every heatmap color.
function drawRover(map, pings, recent = 10) {
  if (!pings.length) return;
  const shown = pings.slice(-recent);
  const path  = shown.map(p => [parseFloat(p.latitude), parseFloat(p.longitude)]);
  if (path.length > 1) {
    L.polyline(path, { color: "#1c261d", weight: 3.5, opacity: 0.3, interactive: false }).addTo(map);
    L.polyline(path, { color: "#ffffff", weight: 1.5, opacity: 0.8, dashArray: "5 6", interactive: false }).addTo(map);
  }
  const first = new Date(pings[0].timestamp), last = pings[pings.length - 1];
  shown.forEach((p, i) => {
    const isLatest = i === shown.length - 1;
    const ll = [parseFloat(p.latitude), parseFloat(p.longitude)];
    L.circle(ll, {
      radius: WIFI_RADIUS_METERS, color: "#ffffff", weight: isLatest ? 1.5 : 1, dashArray: "4 4",
      opacity: isLatest ? 0.85 : 0.35, fillColor: "#ffffff", fillOpacity: isLatest ? 0.1 : 0.03, interactive: false
    }).addTo(map);
    const when = new Date(p.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const body = isLatest
      ? `<dl><dt>Seen</dt><dd>${when}</dd><dt>Position</dt><dd>${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}</dd><dt>Pings</dt><dd>${pings.length}</dd><dt>First seen</dt><dd>${first.toLocaleDateString([], { month: "short", day: "numeric" })}</dd><dt>Wi-Fi range</dt><dd>~${WIFI_RADIUS_METERS} m</dd></dl>`
      : `<dl><dt>Seen</dt><dd>${when}</dd></dl>`;
    L.marker(ll, { icon: roverIcon(isLatest), zIndexOffset: isLatest ? 0 : -500 })
      .addTo(map).bindPopup(`<div class="pop"><div class="pop-title">${isLatest ? "Rover" : "Rover, earlier"}</div>${body}</div>`);
  });
  return last;
}

// Frame the traps inside the part of the map the floating panels don't cover.
// `clear` is the space [left, top, right, bottom] the panels take up, in pixels.
function fitToTraps(map, placed, clear = [0, 0, 0, 0]) {
  if (placed.length === 1) { map.setView(placed[0].coords, 17); return; }
  if (placed.length < 2) return;
  map.fitBounds(L.latLngBounds(placed.map(t => t.coords)), {
    paddingTopLeft:     [40 + clear[0], 40 + clear[1]],
    paddingBottomRight: [40 + clear[2], 40 + clear[3]],
    maxZoom: 18
  });
}

// The map key's contents. `extra` adds page-specific rows before the rover rows.
function mapKeyItems(kind) {
  const chip = inner => `<span class="key-chip">${inner}</span>`;
  if (kind === "setup") {
    return `
      <li>${chip('<span class="key-boundary"></span>')}Orchard boundary</li>
      <li>${chip('<span class="key-radius"></span>')}1-mile pheromone radius</li>
      <li>${chip('<span class="pin">1</span>')}Trap</li>`;
  }
  if (kind === "layout") {
    return `
      <li>${chip('<span class="key-boundary"></span>')}Orchard boundary</li>
      <li>${chip('<span class="pin is-plan">1</span>')}Planned trap</li>
      <li>${chip('<span class="pin is-plan is-repeater">1</span>')}Planned repeater</li>
      <li>${chip('<span class="pin">1</span>')}Trap already deployed</li>
      <li>${chip('<span class="key-drift"></span>')}Planned → where it went in</li>`;
  }
  return `
    <li>${chip('<span class="pin">1</span>')}Trap</li>
    <li>${chip('<span class="pin is-missed">1</span>')}Trap that missed the last pass</li>
    <li>${chip('<span class="rover-mark"></span>')}Rover, latest position</li>
    <li>${chip('<span class="key-route"></span>')}Rover route</li>
    <li>${chip('<span class="key-range"></span>')}Rover Wi-Fi range (~${WIFI_RADIUS_METERS} m)</li>`;
}

// ── Dev tools link ───────────────────────────────────────
// A header link to the field gateway's own page, for development. Hidden unless this
// browser was switched on by opening any dashboard page with ?dev=1 (?dev=0 turns it off).
const DEV_TOOLS_URL = "http://10.42.0.1:8080/";

function setupDevLink() {
  const params = new URLSearchParams(location.search);
  const asked  = params.has("dev") ? params.get("dev") === "1" : null;
  let on = asked === true;
  try {
    if (asked !== null) localStorage.setItem("smarttrap-dev", asked ? "1" : "0");
    on = localStorage.getItem("smarttrap-dev") === "1";
  } catch {}
  if (asked !== null) {
    params.delete("dev");
    const qs = params.toString();
    history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
  }
  const end = document.querySelector(".app-header-end");
  if (on && end && !end.querySelector(".dev-link")) {
    end.insertAdjacentHTML("afterbegin",
      `<a class="btn btn-outline btn-sm dev-link" href="${DEV_TOOLS_URL}" target="_blank" rel="noopener">Dev tools ↗</a>`);
  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupDevLink);
else setupDevLink();

// Open/closed key that remembers its state per page. Storage can be unavailable.
// On a narrow map it starts closed, so it doesn't sit on top of the heatmap panel.
function setupMapKey(root, kind, storageKey, openByDefault = true) {
  if (root.parentElement && root.parentElement.clientWidth < 760) openByDefault = false;
  root.innerHTML = `
    <div class="key-body" id="${storageKey}-body"><ul>${mapKeyItems(kind)}</ul></div>
    <button class="btn btn-outline btn-sm key-toggle" type="button" aria-controls="${storageKey}-body">Key</button>`;
  const body = root.querySelector(".key-body"), btn = root.querySelector(".key-toggle");
  let open = openByDefault;
  try { const saved = localStorage.getItem(storageKey); if (saved !== null) open = saved === "1"; } catch {}
  const apply = () => { body.hidden = !open; btn.setAttribute("aria-expanded", String(open)); btn.textContent = open ? "Hide key" : "Key"; };
  btn.addEventListener("click", () => {
    open = !open; apply();
    try { localStorage.setItem(storageKey, open ? "1" : "0"); } catch {}
  });
  apply();
}
