// ====== KONFIG ======
const WORKER_URL = "https://train.etfnordic.workers.dev"; // din worker
const REFRESH_MS = 15000; // 15s

// ====== UI refs ======
const lastUpdateEl = document.getElementById("lastUpdate");
const countEl = document.getElementById("count");
const errorBox = document.getElementById("errorBox");

// ====== Leaflet map ======
const map = L.map("map", { zoomControl: true }).setView([62.0, 15.0], 5);

// OpenStreetMap tiles
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap-bidragsgivare',
}).addTo(map);

// Layer för alla tågmarkörer
const trainsLayer = L.layerGroup().addTo(map);

// Håll koll på markörer per tåg så vi kan uppdatera istället för att rita om allt
const markersByKey = new Map();

// ====== Hjälpfunktioner ======
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

// Trafikverket skickar Position.WGS84 som string typ:
// "POINT (18.05854634121404 59.33383190994468)"
function parseWgs84Point(pointStr) {
  if (!pointStr || typeof pointStr !== "string") return null;
  const m = pointStr.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

// Skapa en pil som SVG. Vi roterar den via CSS transform.
function createArrowDivIcon(bearingDeg = 0) {
  // Normalisera
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

// Unik nyckel per tåg: använd operational number + departure date (stabilt)
function makeTrainKey(tp) {
  const op = tp?.Train?.OperationalTrainNumber ?? "unknown";
  const dep = tp?.Train?.OperationalTrainDepartureDate ?? "unknown";
  return `${op}_${dep}`;
}

function popupHtml(tp) {
  const train = tp?.Train ?? {};
  const status = tp?.Status ?? {};
  const pos = tp?.Position ?? {};

  const opNo = train.OperationalTrainNumber ?? "—";
  const advNo = train.AdvertisedTrainNumber ?? "—";
  const depDate = train.OperationalTrainDepartureDate ?? "—";
  const time = tp?.TimeStamp ?? "—";
  const modified = tp?.ModifiedTime ?? "—";

  const bearing = status.Bearing ?? "—";
  const speed = status.Speed ?? "—";
  const active = status.Active ?? "—";
  const delayed = tp?.Delayed ?? "—";

  // Visa också rå WGS84 ifall man vill felsöka
  const wgs84 = pos?.WGS84 ?? "—";

  return `
    <div style="min-width:220px">
      <div style="font-weight:700; font-size:14px; margin-bottom:6px;">
        Tåg ${advNo} <span style="color:#9ca3af; font-weight:600;">(op: ${opNo})</span>
      </div>

      <div style="font-size:13px; line-height:1.35;">
        <div><b>Aktiv:</b> ${active}</div>
        <div><b>Försenad:</b> ${delayed}</div>
        <div><b>Riktning (bearing):</b> ${bearing}</div>
        <div><b>Hastighet:</b> ${speed}</div>
        <div><b>Timestamp:</b> ${formatTime(time)}</div>
        <div><b>Modified:</b> ${formatTime(modified)}</div>
        <div style="margin-top:6px; color:#9ca3af;"><b>Avgångsdatum:</b> ${depDate}</div>
        <div style="margin-top:6px; color:#9ca3af; word-break:break-word;"><b>WGS84:</b> ${wgs84}</div>
      </div>
    </div>
  `;
}

// ====== CSS för pilen (injiceras så du bara behöver 3 filer) ======
const style = document.createElement("style");
style.textContent = `
.train-arrow { background: transparent; border: none; }
.train-arrow .arrow { width: 26px; height: 26px; transform-origin: 50% 50%; }
.train-arrow svg { filter: drop-shadow(0 2px 3px rgba(0,0,0,0.35)); }
`;
document.head.appendChild(style);

// ====== Datahämtning + uppdatering ======
async function fetchTrainPositions() {
  setError("");

  const res = await fetch(WORKER_URL, { method: "GET" });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Worker HTTP ${res.status}\n${txt}`);
  }
  const json = await res.json();

  // Struktur: RESPONSE.RESULT[0].TrainPosition
  const positions = json?.RESPONSE?.RESULT?.[0]?.TrainPosition ?? [];
  return positions;
}

function upsertMarkers(trainPositions) {
  const seenKeys = new Set();

  for (const tp of trainPositions) {
    const key = makeTrainKey(tp);
    seenKeys.add(key);

    const point = parseWgs84Point(tp?.Position?.WGS84);
    if (!point) continue;

    const bearing = tp?.Status?.Bearing ?? 0;

    const existing = markersByKey.get(key);
    if (existing) {
      existing.setLatLng([point.lat, point.lon]);
      existing.setIcon(createArrowDivIcon(bearing));
      existing._tp = tp; // spara senaste data
      // Om popup är öppen: uppdatera innehåll live
      if (existing.isPopupOpen()) existing.setPopupContent(popupHtml(tp));
    } else {
      const marker = L.marker([point.lat, point.lon], {
        icon: createArrowDivIcon(bearing),
        riseOnHover: true,
      });

      marker._tp = tp;
      marker.bindPopup(popupHtml(tp), { closeButton: true });

      marker.addTo(trainsLayer);
      markersByKey.set(key, marker);
    }
  }

  // ta bort markörer som inte längre finns i svaret
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
