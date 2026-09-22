// Orchard geometry: metres, areas, and the trap layout generator.
// Deliberately free of Supabase, Leaflet, and the DOM, so it can be exercised
// from a scratch page over file:// with nothing installed. Load before the page
// script that uses it; js/traps.js does not depend on this file.

// ── Local metres projection ──────────────────────────────
// Equirectangular, anchored at one point. Across an orchard block the error is
// well under a metre, far below GPS error, and it keeps every distance, area,
// and grid calculation in plain metres instead of degrees.
const WGS84_A   = 6378137;            // semi-major axis, m
const WGS84_E2  = 0.00669437999014;   // first eccentricity squared
const ACRES_PER_M2 = 1 / 4046.8564224;

// Metres per degree of latitude and of longitude at this latitude, from the
// WGS84 meridional and normal radii. Round numbers like 110540 are off by ~0.4%
// here, and — worse — off by a DIFFERENT amount on each axis, which would tilt
// and stretch the lattice. Both axes have to come from the same model.
function metresPerDegree(latDeg) {
  const phi = latDeg * Math.PI / 180;
  const s = Math.sin(phi);
  const w = Math.sqrt(1 - WGS84_E2 * s * s);
  const rad = Math.PI / 180;
  return [
    rad * WGS84_A * (1 - WGS84_E2) / (w * w * w),   // along a meridian (lat)
    rad * WGS84_A * Math.cos(phi) / w               // along a parallel (lng)
  ];
}

function localProjection(lat0, lng0) {
  const [ky, kx] = metresPerDegree(lat0);
  return {
    lat0, lng0, kx, ky,
    toXY:     (lat, lng) => [(lng - lng0) * kx, (lat - lat0) * ky],   // [east, north] metres
    toLatLng: (x, y)     => [lat0 + y / ky, lng0 + x / kx]
  };
}

// True great-circle distance, for readouts and for future radio range rings.
function haversineMeters(aLat, aLng, bLat, bLng) {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Projection anchor. The mean of the vertices never divides by a degenerate area.
function verticesMean(poly) {
  let sLat = 0, sLng = 0;
  for (const [lat, lng] of poly) { sLat += lat; sLng += lng; }
  return [sLat / poly.length, sLng / poly.length];
}

// Orchard Setup stores an open ring, but a boundary edited elsewhere may repeat
// its first point. Drop that, so the shoelace sum doesn't see a zero-length edge.
function normalizeRing(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return [];
  const a = poly[0], z = poly[poly.length - 1];
  const closed = Math.abs(a[0] - z[0]) < 1e-12 && Math.abs(a[1] - z[1]) < 1e-12;
  return closed ? poly.slice(0, -1) : poly.slice();
}

// ── Area and centroid ────────────────────────────────────
// Shoelace over a projected ring [[x,y], ...]. The sign depends on winding; the
// centroid is sign-invariant because the same signed a2 is in the sum and divisor.
function ringAreaCentroid(ring) {
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xj, yj] = ring[j], [xi, yi] = ring[i];
    const cross = xj * yi - xi * yj;
    a2 += cross;
    cx += (xj + xi) * cross;
    cy += (yj + yi) * cross;
  }
  if (Math.abs(a2) < 1e-9) {                      // collinear or degenerate
    const n = ring.length || 1;
    return {
      area: 0, signedArea: 0,
      centroid: [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n]
    };
  }
  return { area: Math.abs(a2 / 2), signedArea: a2 / 2, centroid: [cx / (3 * a2), cy / (3 * a2)] };
}

function polygonAreaM2(polyLatLng) {
  const poly = normalizeRing(polyLatLng);
  if (poly.length < 3) return 0;
  const [lat0, lng0] = verticesMean(poly);
  const proj = localProjection(lat0, lng0);
  return ringAreaCentroid(poly.map(([la, ln]) => proj.toXY(la, ln))).area;
}

// ── Containment and the inward setback ───────────────────
// Ray casting on a projected ring [[x,y], ...].
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// The same test in lat/lng, moved here from index.html so the heatmap and the
// layout planner share one copy. Kept as its own loop rather than a wrapper:
// the heatmap calls it thousands of times per redraw and must not allocate.
function pointInPolygon(lat, lng, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][1], yi = poly[i][0];
    const xj = poly[j][1], yj = poly[j][0];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

// Distance from a point to the nearest boundary edge. This is how the setback is
// enforced: keep a candidate only if it is inside AND at least `setback` from
// every edge. Shrinking the polygon instead would self-intersect at reflex
// corners; measuring to every edge is correct on concave boundaries for free.
function distToRing(px, py, ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const d = distToSegment(px, py, ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
    if (d < best) best = d;
  }
  return best;
}

// A boundary drawn across itself carves phantom holes out of the lattice. Cheap
// to detect at these vertex counts, and worth warning about rather than blocking.
function ringSelfIntersects(polyLatLng) {
  const poly = normalizeRing(polyLatLng);
  const n = poly.length;
  if (n < 4) return false;
  const cross = (o, a, b) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if ((i + 1) % n === j || (j + 1) % n === i) continue;   // edges sharing a vertex
      const p1 = poly[i], p2 = poly[(i + 1) % n], p3 = poly[j], p4 = poly[(j + 1) % n];
      const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
      const d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
      if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return true;
    }
  }
  return false;
}

// ── The layout generator ─────────────────────────────────
// A hard stop, so a 1 m spacing over a big block can't hang the tab.
const MAX_CANDIDATES = 20000;

// Ray casting is undefined for a point sitting exactly on an edge, and on a
// near-rectangular block a whole lattice row can land there at once — making the
// count jump around for a hair's change in spacing. Points are always held this
// far inside, which is also just correct: never plan a trap on the fence line.
const EDGE_EPS_M = 0.01;

// opts: { spacingM, rowBearingDeg = 0, setbackM = 0, stagger = false }
// rowBearingDeg is the compass direction the rows run (0 = north-south rows,
// 90 = east-west rows), so it can be dialled to match the tree rows.
// Returns [{ n, label, lat, lng, x, y, u, v, row, col, edgeM }] in walking order.
function generateLattice(polyLatLng, opts) {
  const { spacingM, rowBearingDeg = 0, setbackM = 0, stagger = false } = opts || {};
  const poly = normalizeRing(polyLatLng);
  if (!(spacingM > 0) || poly.length < 3) return [];

  const [lat0, lng0] = verticesMean(poly);
  const proj = localProjection(lat0, lng0);
  const ring = poly.map(([lat, lng]) => proj.toXY(lat, lng));
  const { centroid, area } = ringAreaCentroid(ring);
  if (area < 100) return [];                      // a boundary too small to plan in

  // Rotate into (u, v): u runs along a row, v across the rows.
  const th = (90 - rowBearingDeg) * Math.PI / 180;
  const c = Math.cos(th), s = Math.sin(th);
  const fwd  = (x, y) => [x * c + y * s, -x * s + y * c];
  const back = (u, v) => [u * c - v * s,  u * s + v * c];

  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const [x, y] of ring) {
    const [u, v] = fwd(x, y);
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  const [uC, vC] = fwd(centroid[0], centroid[1]);

  // Square: nearest neighbour = spacing, density 1/s². Quincunx: rows pitched at
  // s·√3/2 and offset half a step, so all six neighbours are exactly s away and
  // the same spacing fits ~15% more traps.
  const colPitch = spacingM;
  const rowPitch = stagger ? spacingM * Math.sqrt(3) / 2 : spacingM;
  if (((uMax - uMin) / colPitch + 1) * ((vMax - vMin) / rowPitch + 1) > MAX_CANDIDATES) return [];

  // Phase-locked to the area centroid, not the bounding box. Anchoring at a
  // corner would slide the whole field sideways every time spacing changes.
  const rows = [];
  const minEdge = Math.max(setbackM, EDGE_EPS_M);
  const jMin = Math.ceil((vMin - vC) / rowPitch), jMax = Math.floor((vMax - vC) / rowPitch);
  for (let j = jMin; j <= jMax; j++) {
    const v   = vC + j * rowPitch;
    const off = (stagger && Math.abs(j) % 2 === 1) ? colPitch / 2 : 0;
    const iMin = Math.ceil((uMin - uC - off) / colPitch);
    const iMax = Math.floor((uMax - uC - off) / colPitch);
    const pts = [];
    for (let i = iMin; i <= iMax; i++) {
      const u = uC + off + i * colPitch;
      const [x, y] = back(u, v);
      if (!pointInRing(x, y, ring)) continue;
      const edgeM = distToRing(x, y, ring);
      if (edgeM < minEdge) continue;
      const [lat, lng] = proj.toLatLng(x, y);
      pts.push({ lat, lng, x, y, u, v, row: j, col: i, edgeM });
    }
    if (pts.length) rows.push({ v, pts });
  }

  // ── Walking order (serpentine) ─────────────────────────
  // Rows run north → south; when the rows themselves run north–south, west →
  // east instead. Taken from the axis directions rather than per-row averages,
  // so it can't wobble on a tie.
  const vDir = back(0, 1), uDir = back(1, 0);     // each is [east, north] metres
  const EPS = 1e-9;
  const rowSign = Math.abs(vDir[1]) > EPS ? -Math.sign(vDir[1]) : Math.sign(vDir[0]);
  const colSign = Math.abs(uDir[0]) > EPS ?  Math.sign(uDir[0]) : -Math.sign(uDir[1]);

  rows.sort((a, b) => rowSign * (a.v - b.v));
  rows.forEach(r => r.pts.sort((a, b) => colSign * (a.u - b.u)));

  const out = [];
  rows.forEach((r, k) => {
    (k % 2 === 1 ? [...r.pts].reverse() : r.pts).forEach(p => {
      p.n = out.length + 1;
      p.label = "P" + String(p.n).padStart(2, "0");
      out.push(p);
    });
  });
  return out;
}

// Renumber after a trim or a manual removal, so labels stay P01..Pnn in order.
function renumberPoints(points) {
  points.forEach((p, i) => { p.n = i + 1; p.label = "P" + String(i + 1).padStart(2, "0"); });
  return points;
}

// Drop the `extra` most marginal points — the ones closest to the boundary — so
// hitting an exact count costs the edge of the pattern, never its interior.
function trimToCount(points, target) {
  const extra = points.length - target;
  if (extra <= 0) return points;
  const doomed = new Set(points.slice().sort((a, b) => a.edgeM - b.edgeM).slice(0, extra));
  return renumberPoints(points.filter(p => !doomed.has(p)));
}

// Compass bearing (0–179) of the boundary's longest edge. Growers draw the
// boundary along the tree rows, so this is a good default row direction.
function dominantBearingDeg(polyLatLng) {
  const poly = normalizeRing(polyLatLng);
  if (poly.length < 2) return 0;
  const [lat0, lng0] = verticesMean(poly);
  const proj = localProjection(lat0, lng0);
  const ring = poly.map(([la, ln]) => proj.toXY(la, ln));
  let best = 0, bestLen = -1;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const dx = ring[i][0] - ring[j][0], dy = ring[i][1] - ring[j][1];
    const len = Math.hypot(dx, dy);
    if (len > bestLen) { bestLen = len; best = Math.atan2(dx, dy); }   // atan2(east, north)
  }
  return Math.round(((best * 180 / Math.PI) % 180 + 180) % 180) % 180;
}

// Spacing whose lattice lands as close to `target` points as possible. Point
// count is a decreasing STEP function of spacing, so an exact hit often doesn't
// exist — this keeps the best attempt rather than assuming it converges.
// Each trial is a full generation, which is cheap, so brute bisection wins over
// anything cleverer. Bisects on log spacing, so it behaves the same on a
// one-acre block and a hundred-acre one.
function solveSpacingForCount(polyLatLng, target, opts = {}, iterations = 24) {
  const trial   = s => generateLattice(polyLatLng, { ...opts, spacingM: s });
  const density = opts.stagger ? Math.sqrt(3) / 2 : 1;
  const area    = polygonAreaM2(polyLatLng);
  if (area <= 0 || !(target >= 1)) return { spacingM: 0, points: [] };

  const s0 = Math.sqrt(area / (target * density));

  // lo = small spacing = many points;  hi = large spacing = few points.
  let lo = s0, hi = s0;
  for (let k = 0; k < 30 && trial(lo).length < target; k++) lo /= 1.25;
  for (let k = 0; k < 30 && trial(hi).length > target; k++) hi *= 1.25;

  let bestS = lo, best = trial(lo);
  const consider = (pts, sv) => {
    const d = Math.abs(pts.length - target), bd = Math.abs(best.length - target);
    // Closest count wins; on a tie take the larger spacing, since fewer and
    // better separated beats cramming traps in.
    if (d < bd || (d === bd && sv > bestS)) { best = pts; bestS = sv; }
  };
  consider(trial(hi), hi);

  // Bisect on "does this spacing still fit at least `target` traps", so we end on
  // the WIDEST spacing that does. Stopping at the first exact hit would return an
  // arbitrary spacing from the middle of the interval and pack traps needlessly.
  for (let k = 0; k < iterations; k++) {
    const mid = Math.sqrt(lo * hi);
    const pts = trial(mid);
    consider(pts, mid);
    if (pts.length >= target) lo = mid; else hi = mid;
  }
  return { spacingM: bestS, points: best };
}

// What the layout actually achieved. On a clipped, rotated, staggered lattice
// this differs from the requested spacing, and that real number is the one the
// grower cares about.
function spacingStats(points) {
  if (points.length < 2) return { min: null, mean: null };
  let sum = 0, min = Infinity;
  for (let i = 0; i < points.length; i++) {
    let best = Infinity;
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      if (d < best) best = d;
    }
    sum += best;
    if (best < min) min = best;
  }
  return { min, mean: sum / points.length };
}

// `count` well-spread indices, seeded at the point nearest the block centre.
// Greedy max-min spread, NOT every-Nth: walking order is serpentine, so every
// Nth point clumps along one edge. This is spread only — it models no radio
// range, so every choice stays overridable by hand.
function pickSpread(points, count) {
  if (count <= 0 || !points.length) return [];
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  let seed = 0, bestD = Infinity;
  points.forEach((p, k) => {
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < bestD) { bestD = d; seed = k; }
  });
  const chosen = new Set([seed]);
  const minD = points.map(p => Math.hypot(p.x - points[seed].x, p.y - points[seed].y));
  while (chosen.size < Math.min(count, points.length)) {
    let far = -1, farD = -1;
    minD.forEach((d, k) => { if (!chosen.has(k) && d > farD) { farD = d; far = k; } });
    if (far < 0) break;
    chosen.add(far);
    points.forEach((p, k) => {
      const d = Math.hypot(p.x - points[far].x, p.y - points[far].y);
      if (d < minD[k]) minD[k] = d;
    });
  }
  return [...chosen];
}
