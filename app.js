// ====== KONFIG ======
const WORKER_URL = "https://train.etfnordic.workers.dev";
const REFRESH_MS = 15000;

// ====== UI ======
const lastUpdateEl = document.getElementById("lastUpdate");
const countEl = document.getElementById("count");
const errorBox = document.getElementById("errorBox");

// ====== KARTA ======
const map = L.map("map", { zoomControl: true }).setView([62.0, 15.0], 5);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap-bidragsgivare",
}).addTo(map);

const trainsLayer = L.layerGroup().addTo(map);
const markersByKey = new Map();

// ====== HELPERS ======
function setError(msg) {
  if (!msg) {
    errorBox.hidden = true;
    errorBox.textContent = "";
    return;
  }
  errorBox.hidden = false;
  errorBox.textContent = msg;
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("sv-SE", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(d);
  } catch {
    return iso ?? "—";
  }
}

// Trafikverket skickar WGS84 som "POINT (lon lat)"
function parseWgs84Point(pointStr) {
  if (!pointStr || typeof pointStr !== "string") return null;
  const m = pointStr.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function createArrowDivIcon(bearingDeg = 0) {
  const rot = Number.isFinite(bearingDeg) ? bearingDeg : 0;

  const svg = `
<svg width="26" height="26" viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M13 2 L22 22 L13 18 L4 22 Z" fill="white" fill-opacity="0.92" stroke="black" stroke-opacity="0.25" stroke-width="1"/>
</svg>`.trim();

  return L.divIcon({
    className: "train-arrow",
    html: `<div class="arrow" style="transform: rotate(${rot}deg)">${svg}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -12],
  });
}

const style = document.createElement("style");
style.textContent = `
.train-arrow { background: transparent; border: none; }
.train-arrow .arrow { width: 26px; height: 26px; transform-origin: 50% 50%; }
.train-arrow svg { filter: drop-shadow(0 2px 3px rgba(0,0,0,0.35)); }
`;
document.head.appendChild(style);

function makeTrainKey(tp) {
  const op = tp?.Train?.OperationalTrainNumber ?? "unknown";
  const dep = tp?.Train?.OperationalTrainDepartureDate ?? "unknown";
  return `${op}_${dep}`;
}

function popupHtml(tp) {
  const train = tp?.Train ?? {};
  const status = tp?.Status ?? {};
  const pos = tp?.Position ?? {};

  // Notera: Bearing ligger på root i din data
  const bearing = tp?.Bearing ?? "—";

  return `
    <div style="min-width:250px">
      <div style="font-weight:800; font-size:14px; margin-bottom:6px;">
        Tåg ${train.AdvertisedTrainNumber ?? "—"}
        <span style="color:#9ca3af; font-weight:650;">(op: ${train.OperationalTrainNumber ?? "—"})</span>
      </div>

      <div style="font-size:13px; line-height:1.35;">
        <div><b>Aktiv:</b> ${status.Active ?? "—"}</div>
        <div><b>Riktning:</b> ${bearing}</div>
        <div style="margin-top:6px;"><b>Senaste positions-tid:</b> ${formatTime(tp.TimeStamp)}</div>
        <div><b>Ändrad:</b> ${formatTime(tp.ModifiedTime)}</div>

        <div style="margin-top:6px; color:#9ca3af;">
          <b>Avgångsdatum (trafikdygn):</b><br/>${train.OperationalTrainDepartureDate ?? "—"}
        </div>

        <div style="margin-top:6px; color:#9ca3af; word-break:break-word;">
          <b>WGS84:</b> ${pos.WGS84 ?? "—"}
        </div>
      </div>
    </div>
  `;
}

// ====== DATA ======
async function fetchTrainPositions() {
  setError("");

  // cache-bust så browsern aldrig återanvänder gammalt svar
  const u = new URL(WORKER_URL);
  u.searchParams.set("_", Date.now().toString());

  const res = await fetch(u.toString(), { method: "GET" });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Worker HTTP ${res.status}\n${txt}`);
  }

  const json = await res.json();
  const tps = json?.RESPONSE?.RESULT?.[0]?.TrainPosition ?? [];
  return tps;
}

function upsertMarkers(trainPositions) {
  const seenKeys = new Set();

  for (const tp of trainPositions) {
    // endast aktiva
    if (tp?.Status?.Active !== true) continue;

    const key = makeTrainKey(tp);
    seenKeys.add(key);

    const pt = parseWgs84Point(tp?.Position?.WGS84);
    if (!pt) continue;

    const bearing = tp?.Bearing ?? 0;

    const existing = markersByKey.get(key);
    if (existing) {
      existing.setLatLng([pt.lat, pt.lon]);
      existing.setIcon(createArrowDivIcon(bearing));
      existing._tp = tp;
      if (existing.isPopupOpen()) existing.setPopupContent(popupHtml(tp));
    } else {
      const marker = L.marker([pt.lat, pt.lon], {
        icon: createArrowDivIcon(bearing),
        riseOnHover: true,
      });

      marker._tp = tp;
      marker.bindPopup(popupHtml(tp));
      marker.addTo(trainsLayer);
      markersByKey.set(key, marker);
    }
  }

  // Ta bort markörer som inte längre syns i datasetet
  for (const [key, marker] of markersByKey.entries()) {
    if (!seenKeys.has(key)) {
      trainsLayer.removeLayer(marker);
      markersByKey.delete(key);
    }
  }

  countEl.textContent = String(markersByKey.size);
}

async function refresh() {
  try {
    const tps = await fetchTrainPositions();
    upsertMarkers(tps);

    lastUpdateEl.textContent = `Uppdaterad ${formatTime(new Date().toISOString())}`;
  } catch (err) {
    setError(String(err?.message ?? err));
    console.error(err);
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
