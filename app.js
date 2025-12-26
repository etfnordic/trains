// === Konfiguration ===
const WS_URL = "wss://train.etfnordic.workers.dev/ws?v=1";
const STALE_MS = 2 * 60 * 1000; // ta bort tåg efter 2 min utan uppdatering
const CLEANUP_EVERY_MS = 30 * 1000;

// === UI helpers ===
const wsDot = document.getElementById("wsDot");
const wsText = document.getElementById("wsText");
const countText = document.getElementById("countText");

function setWsStatus(state, msg) {
  wsDot.classList.remove("ok", "bad");
  if (state === "ok") wsDot.classList.add("ok");
  if (state === "bad") wsDot.classList.add("bad");
  wsText.textContent = msg;
}

function setCount(n) {
  countText.textContent = `${n} tåg`;
}

// === Leaflet karta ===
const map = L.map("map", {
  zoomControl: true,
  preferCanvas: true,
}).setView([59.33, 18.06], 6); // Sverige

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap',
}).addTo(map);

// === Marker-hantering ===
const markers = new Map();   // id -> marker
const lastSeen = new Map();  // id -> timestamp (ms)

function makeArrowIcon(bearingDeg = 0) {
  // Vi bygger en enkel triangel som en DivIcon.
  // CSS-triangel pekar uppåt (0deg = norr). Vi roterar med bearing.
  const rot = Number.isFinite(bearingDeg) ? bearingDeg : 0;

  const html = `
    <div class="train-arrow" style="transform: rotate(${rot}deg);">
      <div class="tri"></div>
    </div>
  `;

  return L.divIcon({
    className: "train-icon",
    html,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function upsertTrain(t) {
  lastSeen.set(t.id, t.ts);

  const popupHtml = `
    <div>
      <b>Tåg ${escapeHtml(t.id)}</b><br>
      Lat/Lon: ${t.lat.toFixed(5)}, ${t.lon.toFixed(5)}<br>
      Fart: ${t.speedKmh.toFixed(1)} km/h<br>
      Kurs: ${t.course ?? "?"}°
    </div>
  `;

  let m = markers.get(t.id);
  if (!m) {
    m = L.marker([t.lat, t.lon], {
      icon: makeArrowIcon(t.course ?? 0),
      keyboard: false,
    }).addTo(map);

    m.bindPopup(popupHtml);
    markers.set(t.id, m);
  } else {
    m.setLatLng([t.lat, t.lon]);
    m.setIcon(makeArrowIcon(t.course ?? 0));
    m.setPopupContent(popupHtml);
  }

  setCount(markers.size);
}

function cleanupStale() {
  const now = Date.now();
  for (const [id, ts] of lastSeen.entries()) {
    if (now - ts > STALE_MS) {
      const m = markers.get(id);
      if (m) map.removeLayer(m);
      markers.delete(id);
      lastSeen.delete(id);
    }
  }
  setCount(markers.size);
}

setInterval(cleanupStale, CLEANUP_EVERY_MS);

// === NMEA RMC parsing ===
function parseRmc(line) {
  if (!line || line[0] !== "$") return null;
  if (!(line.startsWith("$GPRMC") || line.startsWith("$GNRMC"))) return null;

  const noChecksum = line.split("*")[0];
  const parts = noChecksum.split(",");

  // status A = valid
  const status = parts[2];
  if (status !== "A") return null;

  const latRaw = parts[3];
  const latHem = parts[4];
  const lonRaw = parts[5];
  const lonHem = parts[6];

  const speedKnots = parseFloat(parts[7] || "0");
  const course = parseFloat(parts[8] || "NaN");

  const lat = nmeaToDecimal(latRaw, latHem, true);
  const lon = nmeaToDecimal(lonRaw, lonHem, false);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const id = extractTrainId(parts);

  return {
    id,
    lat,
    lon,
    speedKmh: (Number.isFinite(speedKnots) ? speedKnots : 0) * 1.852,
    course: Number.isFinite(course) ? course : null,
    raw: line,
    ts: Date.now(),
  };
}

function nmeaToDecimal(value, hemisphere, isLat) {
  if (!value) return NaN;
  const degLen = isLat ? 2 : 3;

  const deg = parseInt(value.slice(0, degLen), 10);
  const min = parseFloat(value.slice(degLen));

  if (!Number.isFinite(deg) || !Number.isFinite(min)) return NaN;

  let dec = deg + (min / 60);
  if (hemisphere === "S" || hemisphere === "W") dec *= -1;
  return dec;
}

function extractTrainId(parts) {
  // Sök i HELA raden efter "<digits>.trains.se"
  const tail = parts.join(",");

  // Vanligast: 1416.trains.se eller 62010.trains.se
  let m = tail.match(/(?:^|,)\s*(\d+)\.trains\.se\b/i);
  if (m) return m[1];

  // Ibland kan det ligga utan kommatecken före
  m = tail.match(/(\d+)\.trains\.se\b/i);
  if (m) return m[1];

  // Fallback: public.trains.se@YYYY-MM-DD / internal.trains.se@YYYY-MM-DD
  m = tail.match(/\b(public|internal)\.trains\.se@(\d{4}-\d{2}-\d{2})\b/i);
  if (m) return `${m[1]}@${m[2]}`;

  // Sista utväg: hash av lat/lon/time (minskar teleport men inte perfekt)
  // (delar av RMC: tid + lat + lon)
  const time = parts[1] || "";
  const lat = parts[3] || "";
  const lon = parts[5] || "";
  return `unk-${time}-${lat}-${lon}`;
}

// XSS-säker popup
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// === WebSocket connect + reconnect ===
let ws = null;
let reconnectTimer = null;

function connect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  setWsStatus("warn", "Ansluter…");
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setWsStatus("ok", "Live");
  };

  ws.onmessage = (e) => {
    const line = String(e.data).trim();
    const t = parseRmc(line);
    if (!t) return;
    upsertTrain(t);
  };

  ws.onerror = () => {
    // onclose kommer strax efter
    setWsStatus("bad", "Fel");
  };

  ws.onclose = (e) => {
    setWsStatus("bad", `Stängd (${e.code})`);
    // reconnect
    reconnectTimer = setTimeout(connect, 1500);
  };
}

connect();

// === Styles för pilar (injekteras här så du slipper extra CSS-klassfil) ===
const style = document.createElement("style");
style.textContent = `
  .train-icon { background: transparent; border: none; }
  .train-arrow { width: 20px; height: 20px; display: grid; place-items: center; }
  .train-arrow .tri {
    width: 0; height: 0;
    border-left: 7px solid transparent;
    border-right: 7px solid transparent;
    border-bottom: 14px solid rgba(231,238,247,0.92);
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
  }
`;
document.head.appendChild(style);
