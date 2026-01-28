const WORKER_URL = "https://trains.etfnordic.workers.dev/trains";
const REFRESH_MS = 5000;

// Visuellt: dimma inställda tåg (sätt true om du vill ha 0.35 igen)
const SHOW_CANCELED_DIM = false;

const PRODUCT_COLORS = {
  "Pågatågen": "#6460AD",
  "Pågatågen Exp": "#6460AD",
  "Västtågen": "#007EB1",
  "Krösatågen": "#FCF807",
  "Tåg i Bergslagen": "#851401",
  "Värmlandstrafik": "#F9B000",
  "Arlanda Express": "#FEF380",
  "SJ Nattåg": "#000000",
  "SJ EuroNight": "#000000",
  "SJ InterCity": "#D9D9D9",
  "SJ Snabbtåg": "#D9D9D9",
  "SJ Regional": "#D9D9D9",
  "Vy Snabbtåg": "#019577",
  "Vy": "#019577",
  "X-Tåget": "#F43F5E",
  "Snälltåget": "#51FF00",
  "SL Pendeltåg": "#00ADF0",
  "Norrtåg": "#07235C",
  "Östgötapendel": "#ED1B24",
  "Tågab": "#895129",
  "Öresundståg": "#64748B",
  "VR Snabbtåg": "#00B451",
  "Mälartåg": "#0049A6",
};
const DEFAULT_COLOR = "#FFFFFF";

// ===== KARTA =====
const map = L.map("map", { zoomControl: true }).setView([59.33, 18.06], 6);
L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
    'Tiles style by <a href="https://www.hotosm.org/">Humanitarian OpenStreetMap Team</a>',
}).addTo(map);

// =========================
// USER GEOLOCATION (Google Maps style)
// =========================
let userMarker = null;
let userAccuracyCircle = null;
let userWatchId = null;
let followUser = false;

function makeUserIcon() {
  return L.divIcon({
    className: "userLocWrap",
    html: `<div class="userLocDot"><div class="userLocPulse"></div></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function ensureUserLocation() {
  if (userWatchId !== null) return; // redan igång
  if (!("geolocation" in navigator)) {
    console.warn("Geolocation stöds inte i den här webbläsaren.");
    return;
  }

  userWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      const latlng = [latitude, longitude];
      const acc = Math.max(Number(accuracy || 0), 10);

      if (!userMarker) {
        userMarker = L.marker(latlng, {
          icon: makeUserIcon(),
          zIndexOffset: 4000,
          keyboard: false,
        }).addTo(map);

        userAccuracyCircle = L.circle(latlng, {
          radius: acc,
          weight: 1,
          color: "rgba(26,115,232,0.45)",
          fillColor: "rgba(26,115,232,0.25)",
          fillOpacity: 1,
          opacity: 1,
        }).addTo(map);
      } else {
        userMarker.setLatLng(latlng);
        userAccuracyCircle.setLatLng(latlng);
        userAccuracyCircle.setRadius(acc);
      }

      if (followUser) {
        map.setView(latlng, Math.max(map.getZoom(), 14), { animate: true });
      }
    },
    (err) => {
      console.warn("GPS-fel:", err?.message || err);
      // Om permission nekas osv – lämna knappen så användaren kan försöka igen.
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1500,
      timeout: 10000,
    },
  );
}

// En “Google Maps”-liknande locate-knapp (user gesture hjälper i många browsers)
const LocateControl = L.Control.extend({
  options: { position: "bottomright" },
  onAdd() {
    const btn = L.DomUtil.create("button", "locateBtn");
    btn.type = "button";
    btn.title = "Visa min position";
    btn.innerHTML = "⌖";

    L.DomEvent.disableClickPropagation(btn);
    L.DomEvent.on(btn, "click", (e) => {
      L.DomEvent.stop(e);

      ensureUserLocation();
      followUser = true;

      if (userMarker) {
        const ll = userMarker.getLatLng();
        map.setView(ll, Math.max(map.getZoom(), 14), { animate: true });
      } else {
        // Om vi inte har en fix ännu: försök med getCurrentPosition för snabb första fix
        if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const ll = [pos.coords.latitude, pos.coords.longitude];
              map.setView(ll, Math.max(map.getZoom(), 14), { animate: true });
            },
            () => {},
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
          );
        }
      }

      // Visuell state
      btn.classList.add("is-following");
    });

    // Sluta följa om användaren själv rör kartan (Google Maps-beteende)
    const stopFollow = () => {
      if (!followUser) return;
      followUser = false;
      btn.classList.remove("is-following");
    };
    map.on("dragstart", stopFollow);
    map.on("zoomstart", stopFollow);

    return btn;
  },
});
map.addControl(new LocateControl());

// Försök starta direkt också (funkar fint på GitHub Pages/HTTPS)
ensureUserLocation();

// ===== STATE =====
const markers = new Map(); // key -> marker
const trainDataByKey = new Map(); // key -> train

// ===== LABEL SYSTEM (SL-style) =====
let hoverKey = null;
let hoverLabelMarker = null;

let pinnedKey = null;
let pinnedLabelMarker = null;

let isPointerOverTrain = false;

const LABEL_OFFSET_Y_PX = 18;

// För hastighetsestimat
const lastSamplesByKey = new Map(); // key -> [{ lat, lon, tsMs }, ...]
const lastEstSpeedByKey = new Map(); // key -> { speed, tsMs }

// Bearing-baserat speed state (alpha-beta) per tåg
const speedStateByKey = new Map(); // key -> { vMps, aMps2, lastTsMs, lastLat, lastLon }

// Cache: senaste kända product/to per tågnr (för att undvika null-flimmer)
const lastKnownByTrainNo = new Map(); // trainNo -> { product, to, tsMs }
const LAST_KNOWN_TTL_MS = 30 * 60 * 1000; // 30 min

function isMissing(v) {
  return v === null || v === undefined || v === "" || v === "null";
}

function cleanupLastKnownCache(activeTrainNos) {
  const now = Date.now();
  const active = activeTrainNos instanceof Set ? activeTrainNos : new Set(activeTrainNos);

  for (const [trainNo, cached] of lastKnownByTrainNo.entries()) {
    const expired = !cached || (now - (cached.tsMs ?? 0)) > LAST_KNOWN_TTL_MS;
    const missing = !active.has(trainNo);
    if (expired || missing) lastKnownByTrainNo.delete(trainNo);
  }
}

let filterQuery = "";
let userInteractedSinceSearch = false;

// ===== SÖK =====
const searchEl = document.getElementById("search");
const clearBtn = document.getElementById("clearSearch");

function normalize(s) {
  return String(s ?? "").toLowerCase().trim();
}

function matchesFilter(t) {
  if (!filterQuery) return true;
  const hay = `${t.trainNo} ${t.product ?? ""} ${t.to ?? ""}`.toLowerCase();
  return hay.includes(filterQuery);
}

function applyFilterAndMaybeZoom() {
  let matchKeys = [];
  for (const [key, marker] of markers.entries()) {
    const t = trainDataByKey.get(key);
    const ok = t ? matchesFilter(t) : true;

    if (ok) {
      if (!map.hasLayer(marker)) marker.addTo(map);
      matchKeys.push(key);
    } else {
      if (map.hasLayer(marker)) map.removeLayer(marker);
      if (pinnedKey === key) clearPinnedLabel();
      if (hoverKey === key) clearHoverLabel();
    }
  }

  if (filterQuery && matchKeys.length === 1 && !userInteractedSinceSearch) {
    const key = matchKeys[0];
    const marker = markers.get(key);
    if (marker) {
      const ll = marker.getLatLng();
      map.setView(ll, Math.max(map.getZoom(), 10), { animate: true });
      showHoverLabelForKey(key);
    }
  }
}

function debounce(fn, ms = 120) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

searchEl.addEventListener(
  "input",
  debounce(() => {
    filterQuery = normalize(searchEl.value);
    userInteractedSinceSearch = false;
    applyFilterAndMaybeZoom();
  }, 120),
);

clearBtn.addEventListener("click", () => {
  searchEl.value = "";
  filterQuery = "";
  userInteractedSinceSearch = false;
  applyFilterAndMaybeZoom();
  searchEl.focus();
});

map.on("dragstart", () => {
  userInteractedSinceSearch = true;
});
map.on("zoomstart", () => {
  userInteractedSinceSearch = true;
});

// ===== HELPERS =====
function colorForProduct(product) {
  return PRODUCT_COLORS[product] ?? DEFAULT_COLOR;
}

function hexToRgb(hex) {
  const h = String(hex ?? "").trim();
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function bestTextColor(bgHex) {
  const rgb = hexToRgb(bgHex);
  if (!rgb) return "#fff";
  const srgb = [rgb.r, rgb.g, rgb.b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  return L > 0.55 ? "#0B1220" : "#ffffff";
}

// Bearing offset
const BEARING_OFFSET_DEG = -45;

function makeTrainDivIcon({ color, bearing }) {
  const rot = (bearing ?? 0) + BEARING_OFFSET_DEG;
  const html = `
    <div class="train-icon" style="transform: rotate(${rot}deg);">
      ${makeArrowSvg(color)}
    </div>
  `;
  return L.divIcon({
    className: "",
    html,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function makeArrowSvg(color) {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.36328 12.0523C4.01081 11.5711 3.33457 11.3304 3.13309 10.9655C2.95849 10.6492 2.95032 10.2673 3.11124 9.94388C3.29694 9.57063 3.96228 9.30132 5.29295 8.76272L17.8356 3.68594C19.1461 3.15547 19.8014 2.89024 20.2154 3.02623C20.5747 3.14427 20.8565 3.42608 20.9746 3.7854C21.1106 4.19937 20.8453 4.85465 20.3149 6.16521L15.2381 18.7078C14.6995 20.0385 14.4302 20.7039 14.0569 20.8896C13.7335 21.0505 13.3516 21.0423 13.0353 20.8677C12.6704 20.6662 12.4297 19.99 11.9485 18.6375L10.4751 14.4967C10.3815 14.2336 10.3347 14.102 10.2582 13.9922C10.1905 13.8948 10.106 13.8103 10.0086 13.7426C9.89876 13.6661 9.76719 13.6193 9.50407 13.5257L5.36328 12.0523Z"
        fill="${color}" stroke="rgba(0,0,0,0.28)" stroke-width="1.2" />
    </svg>
  `;
}

function formatChipText(t) {
  const trainNo = String(t.trainNo ?? "").trim();

  const hasProduct = !isMissing(t.product);
  const hasTo = !isMissing(t.to);

  let base = "";
  if (!hasProduct && !hasTo) {
    base = `${trainNo}`;
  } else if (hasProduct && hasTo) {
    base = `${t.product} ${trainNo} → ${t.to}`;
  } else if (hasProduct) {
    base = `${t.product} ${trainNo}`;
  } else {
    base = `${trainNo} → ${t.to}`;
  }

  if (t.speed === null || t.speed === undefined) return base;
  const prefix = t._speedEstimated ? "~" : "";
  return `${base} · ${prefix}${t.speed} km/h`;
}

function safeFileName(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function productLogoPath(product) {
  return `./logos/${safeFileName(product)}.png`;
}

function chipHtml(t, color) {
  const logo = productLogoPath(t.product);
  const textColor = bestTextColor(color);
  return `
    <div class="chip" style="background:${color}; color:${textColor};">
      <img class="logo" src="${logo}" alt="${t.product}" onerror="this.style.display='none'">
      <span>${formatChipText(t)}</span>
    </div>
  `;
}

// ===== Label icon (SL-style) =====
function makeLabelDivIcon(t, color, pinned) {
  const wrapper = `
    <div class="trainLabelPos" style="--label-gap:${LABEL_OFFSET_Y_PX}px;">
      ${chipHtml(t, color)}
    </div>
  `;

  return L.divIcon({
    className: pinned ? "train-chip pinned" : "train-chip",
    html: wrapper,
    iconSize: [1, 1],
    iconAnchor: [0.5, 0.5],
  });
}

function setGlow(marker, on) {
  const el = marker.getElement();
  if (!el) return;
  el.classList.toggle("train-selected", on);
}

function clearHoverLabel() {
  if (hoverLabelMarker) {
    map.removeLayer(hoverLabelMarker);
    hoverLabelMarker = null;
  }
  hoverKey = null;
}

function clearPinnedLabel() {
  if (pinnedKey) {
    const m = markers.get(pinnedKey);
    if (m) setGlow(m, false);
  }
  if (pinnedLabelMarker) {
    map.removeLayer(pinnedLabelMarker);
    pinnedLabelMarker = null;
  }
  pinnedKey = null;
}

function showHoverLabelForKey(key) {
  if (!key) return;
  const t = trainDataByKey.get(key);
  const m = markers.get(key);
  if (!t || !m) return;
  showHoverLabel(key, t, m.getLatLng());
}

function showHoverLabel(key, t, pos) {
  if (pinnedKey === key) return;

  if (hoverKey && hoverKey !== key) clearHoverLabel();

  hoverKey = key;
  const color = colorForProduct(t.product);
  const icon = makeLabelDivIcon(t, color, false);

  if (!hoverLabelMarker) {
    hoverLabelMarker = L.marker(pos, {
      icon,
      interactive: false,
      zIndexOffset: 2000,
      keyboard: false,
    }).addTo(map);
  } else {
    hoverLabelMarker.setLatLng(pos);
    hoverLabelMarker.setIcon(icon);
  }
}

function hideHoverLabel(key) {
  if (hoverKey !== key) return;
  if (pinnedKey === key) return;
  clearHoverLabel();
}

function togglePinnedLabel(key, t, pos) {
  clearHoverLabel();
  isPointerOverTrain = false;

  if (pinnedKey === key) {
    clearPinnedLabel();
    return;
  }

  clearPinnedLabel();

  pinnedKey = key;
  const color = colorForProduct(t.product);
  const icon = makeLabelDivIcon(t, color, true);

  setGlow(markers.get(key), true);

  pinnedLabelMarker = L.marker(pos, {
    icon,
    interactive: false,
    zIndexOffset: 2500,
    keyboard: false,
  }).addTo(map);
}

function syncLabelToMarker(key, markerLatLng) {
  if (hoverKey === key && hoverLabelMarker && pinnedKey !== key) {
    hoverLabelMarker.setLatLng(markerLatLng);
  }
  if (pinnedKey === key && pinnedLabelMarker) {
    pinnedLabelMarker.setLatLng(markerLatLng);
  }
}

function syncLabelIconIfNeeded(key, t) {
  const color = colorForProduct(t.product);
  if (hoverKey === key && hoverLabelMarker && pinnedKey !== key) {
    hoverLabelMarker.setIcon(makeLabelDivIcon(t, color, false));
  }
  if (pinnedKey === key && pinnedLabelMarker) {
    pinnedLabelMarker.setIcon(makeLabelDivIcon(t, color, true));
  }
}

function attachHoverAndClick(marker, key) {
  marker.on("mouseover", () => {
    isPointerOverTrain = true;
    const t = trainDataByKey.get(key);
    if (!t) return;
    showHoverLabel(key, t, marker.getLatLng());
  });

  marker.on("mouseout", () => {
    isPointerOverTrain = false;
    hideHoverLabel(key);
  });

  marker.on("click", (e) => {
    L.DomEvent.stop(e);
    const t = trainDataByKey.get(key);
    if (!t) return;
    togglePinnedLabel(key, t, marker.getLatLng());
  });
}

map.on("click", () => {
  clearPinnedLabel();
  clearHoverLabel();
  isPointerOverTrain = false;
});

map.on("mousemove", () => {
  if (!isPointerOverTrain && hoverKey && hoverLabelMarker && pinnedKey !== hoverKey) {
    clearHoverLabel();
  }
});

// ===== Smooth move =====
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function animateMarkerTo(key, marker, toLatLng, durationMs = 850) {
  const from = marker.getLatLng();
  const to = L.latLng(toLatLng[0], toLatLng[1]);
  const start = performance.now();

  function step(now) {
    const tt = Math.min(1, (now - start) / durationMs);
    const ll = L.latLng(lerp(from.lat, to.lat, tt), lerp(from.lng, to.lng, tt));
    marker.setLatLng(ll);
    syncLabelToMarker(key, ll);
    if (tt < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ===== DATA-NORMALISERING =====
function normalizeProduct(rawProduct) {
  if (rawProduct === "TiB") return "Tåg i Bergslagen";
  if (rawProduct === "VTAB") return "Värmlandstrafik";
  return rawProduct;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ===== BETTER SPEED ESTIMATION + CAP 200 =====
const SPEED_CAP = 200;

const MAX_SAMPLES = 10; // lite fler så median blir stabil
const WINDOW_MS = 90_000; // analysera senaste 90s
const MIN_SEG_DT_MS = 6_000; // minst 6s mellan punkter
const MIN_SEG_DIST_KM = 0.05; // ignorera små hopp (brus)
const REUSE_EST_MS = 90_000; // återanvänd senaste est om vi saknar underlag

function pushSample(key, sample) {
  const arr = lastSamplesByKey.get(key) ?? [];
  const last = arr[arr.length - 1];

  if (last && last.tsMs === sample.tsMs) {
    arr[arr.length - 1] = sample;
  } else {
    arr.push(sample);
  }

  // trim + rensa för gamla (över WINDOW_MS) men behåll lite slack
  const newest = arr[arr.length - 1]?.tsMs ?? sample.tsMs;
  const minTs = newest - (WINDOW_MS + 60_000);
  while (arr.length > 0 && arr[0].tsMs < minTs) arr.shift();
  while (arr.length > MAX_SAMPLES) arr.shift();

  lastSamplesByKey.set(key, arr);
  return arr;
}

function median(values) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// Bygger segmenthastigheter och tar median (robust mot outliers)
function estimateSpeedFromSamples(key, current) {
  const arr = lastSamplesByKey.get(key);
  if (!arr || arr.length < 3) return null;
  if (!Number.isFinite(current.tsMs)) return null;

  const cutoff = current.tsMs - WINDOW_MS;

  // välj samples inom fönster
  const pts = arr.filter((s) => s.tsMs >= cutoff && s.tsMs <= current.tsMs);
  if (pts.length < 3) return null;

  const speeds = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dt = b.tsMs - a.tsMs;
    if (dt < MIN_SEG_DT_MS) continue;

    const dist = haversineKm(a.lat, a.lon, b.lat, b.lon);
    if (!Number.isFinite(dist) || dist < MIN_SEG_DIST_KM) continue;

    const v = dist / (dt / 3_600_000);
    if (!Number.isFinite(v) || v < 2) continue;

    speeds.push(Math.min(v, SPEED_CAP));
  }

  if (speeds.length < 2) return null;

  // extra outlier-trim: ta bort topp 10% om många punkter
  speeds.sort((x, y) => x - y);
  if (speeds.length >= 6) {
    const cut = Math.floor(speeds.length * 0.9);
    speeds.length = Math.max(2, cut);
  }

  return median(speeds);
}

function smoothEstimate(key, rawEst, tsMs) {
  const prev = lastEstSpeedByKey.get(key);
  if (prev && Number.isFinite(prev.speed) && tsMs - prev.tsMs <= REUSE_EST_MS) {
    // lite mindre “drag” än innan (snabbare att följa verkligheten)
    return 0.55 * prev.speed + 0.45 * rawEst;
  }
  return rawEst;
}

// --- Bearing speed helpers (lokal meter-approx + along-track projektion) ---
function latLonToLocalMeters(lat, lon, refLat, refLon) {
  // Equirectangular approximation around ref point (meters)
  const R = 6371000; // meters
  const toRad = (d) => (d * Math.PI) / 180;

  const phi = toRad(lat);
  const phi0 = toRad(refLat);
  const dPhi = toRad(lat - refLat);
  const dLam = toRad(lon - refLon);

  const x = R * dLam * Math.cos((phi + phi0) / 2); // east (m)
  const y = R * dPhi; // north (m)
  return { x, y };
}

function estimateSpeedWithBearingAlphaBeta(key, lat, lon, bearingDeg, tsMs) {
  if (!Number.isFinite(tsMs)) return null;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(bearingDeg)) return null;

  const st = speedStateByKey.get(key);
  if (!st) {
    speedStateByKey.set(key, {
      vMps: 0,
      aMps2: 0,
      lastTsMs: tsMs,
      lastLat: lat,
      lastLon: lon,
    });
    return null; // behöver minst 2 punkter
  }

  if (tsMs <= st.lastTsMs) return null;

  const dt = (tsMs - st.lastTsMs) / 1000; // seconds
  // Gate dt
  if (dt < 0.5 || dt > 120) {
    st.lastTsMs = tsMs;
    st.lastLat = lat;
    st.lastLon = lon;
    return null;
  }

  const m = latLonToLocalMeters(lat, lon, st.lastLat, st.lastLon);
  const dx = m.x;
  const dy = m.y;

  const distM = Math.hypot(dx, dy);

  // Bearing 0=N, 90=E. x=east, y=north => unit=(sin, cos)
  const th = (bearingDeg * Math.PI) / 180;
  const ux = Math.sin(th);
  const uy = Math.cos(th);

  // Along-track (projektion längs bearing) -> mindre sidjitter
  let along = dx * ux + dy * uy;

  // FIX 1: hård clamp för att undvika "bakåthopp" => speed studs
  if (along < 0) along = 0;

  const instMps = along / dt;
  const instKmh = instMps * 3.6;

  // Outlier gates
  const MAX_KMH_GATE = 350; // gate (display cap är 200)
  const MIN_DIST_M = 12; // FIX 2: ignorera små hopp (brus) mer aggressivt
  const ok = instKmh >= 0 && instKmh <= MAX_KMH_GATE && (distM >= MIN_DIST_M || dt >= 8);

  // Uppdatera last oavsett, så vi inte “fastnar”
  st.lastTsMs = tsMs;
  st.lastLat = lat;
  st.lastLon = lon;

  if (!ok) return null;

  // FIX 3: adaptiv alpha/beta (stabil vid låg fart, snabbare vid hög)
  const vPred = st.vMps + st.aMps2 * dt;
  const vKmhPred = Math.max(0, vPred * 3.6);

  let alpha, beta;
  if (vKmhPred < 30) {
    alpha = 0.18;
    beta = 0.03;
  } else if (vKmhPred < 90) {
    alpha = 0.25;
    beta = 0.05;
  } else {
    alpha = 0.32;
    beta = 0.07;
  }

  const r = instMps - vPred;

  st.vMps = vPred + alpha * r;
  st.aMps2 = st.aMps2 + (beta * r) / dt;

  // Clamp till 0..SPEED_CAP
  const vKmh = Math.max(0, st.vMps * 3.6);
  return Math.min(SPEED_CAP, vKmh);
}

function normalizeTrain(tIn) {
  const t = { ...tIn };

  t.product = normalizeProduct(t.product);

  const n = Number(t.trainNo);
  if (Number.isFinite(n) && n >= 7700 && n <= 7999) {
    t.product = "Arlanda Express";
    t.to = n % 2 === 1 ? "Stockholm C" : "Arlanda";
  }

  // SL Pendeltåg: "1 km/h" default -> behandla som null
  if (t.product === "SL Pendeltåg" && t.speed === 1) {
    t.speed = null;
  }

  // Snygga upp "null" (kan komma och gå från API)
  if (isMissing(t.product)) t.product = null;
  if (isMissing(t.to)) t.to = null;

  // Fyll i från senaste kända om fält går till null
  const trainNoKey = String(t.trainNo ?? "");
  const now = Date.now();
  if (trainNoKey) {
    const cached = lastKnownByTrainNo.get(trainNoKey);

    const gotProduct = !isMissing(t.product);
    const gotTo = !isMissing(t.to);

    if (gotProduct || gotTo) {
      lastKnownByTrainNo.set(trainNoKey, {
        product: gotProduct ? t.product : (cached?.product ?? null),
        to: gotTo ? t.to : (cached?.to ?? null),
        tsMs: now,
      });
    }

    const fresh = cached && (now - (cached.tsMs ?? 0) < LAST_KNOWN_TTL_MS);
    if (fresh) {
      if (!gotProduct) t.product = cached.product;
      if (!gotTo) t.to = cached.to;
    }
  }

  const key = `${t.depDate}_${t.trainNo}`;
  const tsMs = Date.parse(t.timeStamp ?? "");

  if (Number.isFinite(tsMs) && typeof t.lat === "number" && typeof t.lon === "number") {
    pushSample(key, { lat: t.lat, lon: t.lon, tsMs });
  }

  // clamp även “riktig” speed (så du aldrig visar >200)
  if (t.speed !== null && t.speed !== undefined && Number.isFinite(Number(t.speed))) {
    t.speed = Math.min(Number(t.speed), SPEED_CAP);
  }

  // Estimera om null (bearing först, annars fallback till din tidigare median-metod)
  t._speedEstimated = false;
  if (t.speed === null || t.speed === undefined) {
    let est = null;

    if (Number.isFinite(tsMs) && typeof t.lat === "number" && typeof t.lon === "number") {
      est = estimateSpeedWithBearingAlphaBeta(key, t.lat, t.lon, Number(t.bearing), tsMs);
      if (est !== null && Number.isFinite(est)) {
        t.speed = Math.min(SPEED_CAP, Math.round(est));
        t._speedEstimated = true;
        lastEstSpeedByKey.set(key, { speed: t.speed, tsMs });
      }
    }

    // Fallback till befintlig metod om bearing-estimat inte finns ännu
    if (!t._speedEstimated && Number.isFinite(tsMs)) {
      const raw = estimateSpeedFromSamples(key, { lat: t.lat, lon: t.lon, tsMs });
      if (raw !== null) {
        const smoothed = smoothEstimate(key, raw, tsMs);
        t.speed = Math.min(SPEED_CAP, Math.round(smoothed));
        t._speedEstimated = true;
        lastEstSpeedByKey.set(key, { speed: t.speed, tsMs });
      } else {
        const prev = lastEstSpeedByKey.get(key);
        if (prev && Number.isFinite(prev.speed) && tsMs - prev.tsMs <= REUSE_EST_MS) {
          t.speed = Math.min(SPEED_CAP, prev.speed);
          t._speedEstimated = true;
        }
      }
    }
  }

  return t;
}

// ===== FETCH =====
async function fetchTrains() {
  const res = await fetch(WORKER_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.trains)) return data.trains;
  return [];
}

// ===== UPSERT =====
function upsertTrain(t) {
  t = normalizeTrain(t);
  const key = `${t.depDate}_${t.trainNo}`;
  trainDataByKey.set(key, t);

  const color = colorForProduct(t.product);
  const opacity = (SHOW_CANCELED_DIM && t.canceled) ? 0.35 : 1;

  if (!markers.has(key)) {
    const marker = L.marker([t.lat, t.lon], {
      icon: makeTrainDivIcon({ color, bearing: t.bearing }),
      opacity,
    }).addTo(map);

    attachHoverAndClick(marker, key);
    markers.set(key, marker);
  } else {
    const marker = markers.get(key);

    animateMarkerTo(key, marker, [t.lat, t.lon], 850);

    marker.setIcon(makeTrainDivIcon({ color, bearing: t.bearing }));
    marker.setOpacity(opacity);

    syncLabelIconIfNeeded(key, t);

    if (pinnedKey === key) setGlow(marker, true);
  }

  return key;
}

// ===== LOOP =====
async function refresh() {
  try {
    if (document.hidden) return;
    const trains = await fetchTrains();
    const seen = new Set();
    const seenTrainNos = new Set();

    for (const t of trains) {
      if (!t || !t.trainNo) continue;
      if (typeof t.lat !== "number" || typeof t.lon !== "number") continue;
      const key = upsertTrain(t);
      seen.add(key);
      seenTrainNos.add(String(t.trainNo));
    }

    cleanupLastKnownCache(seenTrainNos);

    for (const [key, marker] of markers.entries()) {
      if (!seen.has(key)) {
        if (pinnedKey === key) clearPinnedLabel();
        if (hoverKey === key) clearHoverLabel();

        if (map.hasLayer(marker)) map.removeLayer(marker);
        markers.delete(key);
        trainDataByKey.delete(key);
        lastSamplesByKey.delete(key);
        lastEstSpeedByKey.delete(key);
        speedStateByKey.delete(key);
      }
    }

    applyFilterAndMaybeZoom();
  } catch (err) {
    console.error("Kunde inte uppdatera tåg:", err);
  }
}

// ===== SCHEDULER =====
let refreshTimer = null;
async function tick() {
  await refresh();
  refreshTimer = setTimeout(tick, REFRESH_MS);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});

tick();
