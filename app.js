// ====== KONFIG ======
const WORKER_URL = "https://train.etfnordic.workers.dev";
const REFRESH_MS = 15000;

// hur “färska” positioner vi vill visa (matchar worker-param)
const MINUTES = 5;

// ====== UI refs ======
const lastUpdateEl = document.getElementById("lastUpdate");
const countEl = document.getElementById("count");
const freshWindowEl = document.getElementById("freshWindow");
const minutesLabelEl = document.getElementById("minutesLabel");
const errorBox = document.getElementById("errorBox");

minutesLabelEl.textContent = String(MINUTES);
freshWindowEl.textContent = `senaste ${MINUTES} min`;

// ====== Leaflet map ======
const map = L.map("map", { zoomControl: true }).setView([62.0, 15.0], 5);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap-bidragsgivare',
}).addTo(map);

const trainsLayer = L.layerGroup().addTo(map);
const markersByKey = new Map();

// ====== Helpers ======
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

function makeTrainKey(t) {
  // Stabil nyckel: opNum + depDate
  return `${t?.opNum ?? "unknown"}_${t?.depDate ?? "unknown"}`;
}

function popupHtml(t) {
  const op = t?.opNum ?? "—";
  const adv = t?.advNum ?? "—";

  const bearing = t?.bearing ?? "—";
  const speed = t?.speed ?? "—";
  const active = t?.active ?? "—";
  const delayed = t?.delayed ?? "—";

  const ts = t?.timeStamp ?? "—";
  const mod = t?.modifiedTime ?? "—";
  const dep = t?.depDate ?? "—";

  return `
    <div style="min-width:240px">
      <div style="font-weight:800; font-size:14px; margin-bottom:6px;">
        Tåg ${adv} <span style="color:#9ca3af; font-weight:650;">(op: ${op})</span>
      </div>

      <div style="font-size:13px; line-height:1.35;">
        <div><b>Aktiv:</b> ${active}</div>
        <div><b>Försenad:</b> ${delayed}</div>
        <div><b>Riktning:</b> ${bearing}</div>
        <div><b>Hastighet:</b> ${speed}</div>
        <div style="margin-top:6px;"><b>Senaste positions-tid:</b> ${formatTime(ts)}</div>
        <div><b>Ändrad:</b> ${formatTime(mod)}</div>
        <div style="margin-top:6px; color:#9ca3af;">
          <b>Avgångsdatum (trafikdygn):</b><br/>${dep}
        </div>
      </div>
    </div>
  `;
}

// Inject CSS for arrow
const style = document.createElement("style");
style.textContent = `
.train-arrow { background: transparent; border: none; }
.train-arrow .arrow { width: 26px; height: 26px; transform-origin: 50% 50%; }
.train-arrow svg { filter: drop-shadow(0 2px 3px rgba(0,0,0,0.35)); }
`;
document.head.appendChild(style);

// ====== Fetch + update ======
async function fetchTrains() {
  setError("");

  // cachebust + minutes param
  const u = new URL(WORKER_URL);
  u.searchParams.set("minutes", String(MINUTES));
  u.searchParams.set("_", String(Date.now()));

  const res = await fetch(u.toString(), { method: "GET", cache: "no-store" });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Worker HTTP ${res.status}\n${txt}`);
  }

  const json = await res.json();
  const trains = json?.trains ?? [];
  return { trains, meta: json?.meta ?? {} };
}

function upsertMarkers(trains) {
  const seen = new Set();

  for (const t of trains) {
    const key = makeTrainKey(t);
    seen.add(key);

    const pt = parseWgs84Point(t?.wgs84);
    if (!pt) continue;

    const bearing = t?.bearing ?? 0;

    const existing = markersByKey.get(key);
    if (existing) {
      existing.setLatLng([pt.lat, pt.lon]);
      existing.setIcon(createArrowDivIcon(bearing));
      existing._t = t;
      if (existing.isPopupOpen()) existing.setPopupContent(popupHtml(t));
    } else {
      const marker = L.marker([pt.lat, pt.lon], {
        icon: createArrowDivIcon(bearing),
        riseOnHover: true,
      });
      marker._t = t;
      marker.bindPopup(popupHtml(t));
      marker.addTo(trainsLayer);
      markersByKey.set(key, marker);
    }
  }

  // Remove stale
  for (const [key, marker] of markersByKey.entries()) {
    if (!seen.has(key)) {
      trainsLayer.removeLayer(marker);
      markersByKey.delete(key);
    }
  }

  countEl.textContent = String(markersByKey.size);
}

async function refresh() {
  try {
    const { trains, meta } = await fetchTrains();
    upsertMarkers(trains);

    lastUpdateEl.textContent = `Uppdaterad ${formatTime(new Date().toISOString())}`;

    // Om du vill se bevis att datan rör sig:
    // console.log("meta:", meta, "first:", trains[0]?.timeStamp);
    if (markersByKey.size === 0) {
      setError(
        `0 tåg returnerade.\nTesta att öka minutes (t.ex. 10) eller kontrollera att worker-filter fungerar.\nmeta: ${JSON.stringify(meta)}`
      );
    }
  } catch (err) {
    setError(String(err?.message ?? err));
    console.error(err);
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
