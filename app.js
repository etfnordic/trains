const WORKER_URL = "https://trains.etfnordic.workers.dev/trains";
const REFRESH_MS = 5000;

const PRODUCT_COLORS = {
  "Pågatågen": "#A855F7",
  "Västtågen": "#2563EB",
  "Krösatågen": "#F59E0B",
  "Tåg i Bergslagen": "#10B981",
  "Värmlandstrafik": "#10B981",
  "Arlanda Express": "#FEF380",
  "SJ InterCity": "#0EA5E9",
  "SJ Nattåg": "#0EA5E9",
  "SJ EuroNight": "#0EA5E9",
  "SJ Snabbtåg": "#0EA5E9",
  "SJ Regional": "#0EA5E9",
  "Vy Snabbtåg": "#0EA5E9",
  "Vy": "#0EA5E9",
  "X-Tåget": "#F97316",
  "Snälltåget": "#22C55E",
  "SL Pendeltåg": "#0EA5E9",
  "Norrtåg": "#F43F5E",
  "Östgötapendeln": "#0EA5E9",
  "Tågab": "#0EA5E9",
  "Öresundståg": "#0EA5E9",
  "VR Snabbtåg": "#0EA5E9",
};
const DEFAULT_COLOR = "#64748B";

// ===== KARTA =====
const map = L.map("map", { zoomControl: true }).setView([59.33, 18.06], 6);
L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
    'Tiles style by <a href="https://www.hotosm.org/">Humanitarian OpenStreetMap Team</a>',
}).addTo(map);

// GPS-position
let userMarker = null;
let userAccuracyCircle = null;
let userWatchId = null;
let followUser = false; // true för att följa

function makeUserIcon() {
  return L.divIcon({
    className: "userLocWrap",
    html: `<div class="userLocDot"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function startUserLocation() {
  if (!("geolocation" in navigator)) {
    console.warn("Geolocation stöds inte i den här webbläsaren.");
    return;
  }

  // Starta live-uppdatering
  userWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      const latlng = [latitude, longitude];

      if (!userMarker) {
        userMarker = L.marker(latlng, { icon: makeUserIcon(), zIndexOffset: 3000 })
          .addTo(map)
          .bindPopup("Din position");

        userAccuracyCircle = L.circle(latlng, {
          radius: Math.max(accuracy || 0, 10),
          weight: 1,
          opacity: 0.4,
          fillOpacity: 0.12,
        }).addTo(map);
      } else {
        userMarker.setLatLng(latlng);
        userAccuracyCircle.setLatLng(latlng);
        userAccuracyCircle.setRadius(Math.max(accuracy || 0, 10));
      }

      if (followUser) {
        map.setView(latlng, Math.max(map.getZoom(), 14), { animate: true });
      }
    },
    (err) => {
      console.warn("GPS-fel:", err?.message || err);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1500,
      timeout: 10000,
    }
  );
}

// ===== STATE =====
const markers = new Map(); // key -> marker
const trainDataByKey = new Map(); // key -> train

// ===== LABEL SYSTEM (SL-style) =====
let hoverKey = null;
let hoverLabelMarker = null;

let pinnedKey = null;
let pinnedLabelMarker = null;

let isPointerOverTrain = false;

// Justera om chip sitter för nära/för långt: (px uppåt)
const LABEL_OFFSET_Y_PX = 18;

// För hastighetsestimat (när worker skickar null / pendel-"1")
// key -> [{ lat, lon, tsMs }, ...] (senaste sist)
const lastSamplesByKey = new Map();
// key -> { speed, tsMs } (senaste estimerade/smoothede hastighet)
const lastEstSpeedByKey = new Map();

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
  // Endast tågnummer + product
  const hay = `${t.trainNo} ${t.product}`.toLowerCase();
  return hay.includes(filterQuery);
}

function applyFilterAndMaybeZoom() {
  // 1) visa/dölj markers
  let matchKeys = [];
  for (const [key, marker] of markers.entries()) {
    const t = trainDataByKey.get(key);
    const ok = t ? matchesFilter(t) : true;

    if (ok) {
      if (!map.hasLayer(marker)) marker.addTo(map);
      matchKeys.push(key);
    } else {
      if (map.hasLayer(marker)) map.removeLayer(marker);

      // om ett dolt tåg var pinnat/hoverat -> släpp
      if (pinnedKey === key) clearPinnedLabel();
      if (hoverKey === key) clearHoverLabel();
    }
  }

  // 2) auto-zoom om exakt 1 match
  if (filterQuery && matchKeys.length === 1 && !userInteractedSinceSearch) {
    const key = matchKeys[0];
    const marker = markers.get(key);
    if (marker) {
      const ll = marker.getLatLng();
      map.setView(ll, Math.max(map.getZoom(), 10), { animate: true });

      // visa label även om inget är pinnat
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

// Om användaren panorerar/zoomar efter en sökning ska vi inte "dra tillbaka" kameran
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
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

function bestTextColor(bgHex) {
  // WCAG-ish luminans (0..1)
  const rgb = hexToRgb(bgHex);
  if (!rgb) return "#fff";
  const srgb = [rgb.r, rgb.g, rgb.b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  return L > 0.55 ? "#0B1220" : "#ffffff";
}

// Bearing offset: “mittemellan” = -45
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

// Fylld pil
function makeArrowSvg(color) {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.36328 12.0523C4.01081 11.5711 3.33457 11.3304 3.13309 10.9655C2.95849 10.6492 2.95032 10.2673 3.11124 9.94388C3.29694 9.57063 3.96228 9.30132 5.29295 8.76272L17.8356 3.68594C19.1461 3.15547 19.8014 2.89024 20.2154 3.02623C20.5747 3.14427 20.8565 3.42608 20.9746 3.7854C21.1106 4.19937 20.8453 4.85465 20.3149 6.16521L15.2381 18.7078C14.6995 20.0385 14.4302 20.7039 14.0569 20.8896C13.7335 21.0505 13.3516 21.0423 13.0353 20.8677C12.6704 20.6662 12.4297 19.99 11.9485 18.6375L10.4751 14.4967C10.3815 14.2336 10.3347 14.102 10.2582 13.9922C10.1905 13.8948 10.106 13.8103 10.0086 13.7426C9.89876 13.6661 9.76719 13.6193 9.50407 13.5257L5.36328 12.0523Z"
        fill="${color}" stroke="rgba(0,0,0,0.28)" stroke-width="1.2" />
    </svg>
  `;
}

function formatChipText(t) {
  const base = `${t.product} ${t.trainNo} \u2192 ${t.to}`;
  if (t.speed === null || t.speed === undefined) return base;
  const prefix = t._speedEstimated ? "~" : "";
  return `${base} \u00B7 ${prefix}${t.speed} km/h`;
}

// logos: baserat på product
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
    <div class="trainLabelPos">
      ${chipHtml(t, color)}
    </div>
  `;

  return L.divIcon({
    className: pinned ? "train-chip pinned" : "train-chip",
    html: wrapper,
    // Leaflet behöver en "låtsas-storlek" för att kunna ankra snyggt.
    iconSize: [1, 1],
    // Ankaret i mitten av "punkten" -> då hamnar labeln rakt över tåget
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
  // Visa inte hover om samma tåg är pinnat
  if (pinnedKey === key) return;

  // Om vi hoverar en annan: ta bort gamla
  if (hoverKey && hoverKey !== key) {
    clearHoverLabel();
  }

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
  if (pinnedKey === key) return; // aldrig hide om pinnad
  clearHoverLabel();
}

function togglePinnedLabel(key, t, pos) {
  // rensa hover direkt (som i SL)
  clearHoverLabel();
  isPointerOverTrain = false;

  // toggla av
  if (pinnedKey === key) {
    clearPinnedLabel();
    return;
  }

  // annars: släpp tidigare pin
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
  // Flytta labeln (billigt) under animation
  if (hoverKey === key && hoverLabelMarker && pinnedKey !== key) {
    hoverLabelMarker.setLatLng(markerLatLng);
  }
  if (pinnedKey === key && pinnedLabelMarker) {
    pinnedLabelMarker.setLatLng(markerLatLng);
  }
}

function syncLabelIconIfNeeded(key, t) {
  // Byt icon (dyrare än setLatLng) – vi gör det bara vid refresh/upsert, inte per frame.
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

// Släpp pin + hover på kartklick (snabbt)
map.on("click", () => {
  clearPinnedLabel();
  clearHoverLabel();
  isPointerOverTrain = false;
});

// Extra “säkring” som i SL: om musen lämnar tåg utan att out triggar perfekt
map.on("mousemove", () => {
  if (!isPointerOverTrain && hoverKey && hoverLabelMarker && pinnedKey !== hoverKey) {
    clearHoverLabel();
  }
});

// ===== Smooth move =====
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Nu tar vi med key så label kan följa under animation
function animateMarkerTo(key, marker, toLatLng, durationMs = 850) {
  const from = marker.getLatLng();
  const to = L.latLng(toLatLng[0], toLatLng[1]);
  const start = performance.now();

  function step(now) {
    const tt = Math.min(1, (now - start) / durationMs);
    const ll = L.latLng(lerp(from.lat, to.lat, tt), lerp(from.lng, to.lng, tt));
    marker.setLatLng(ll);

    // håll labeln i sync utan tooltip-system
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

const MAX_SAMPLES = 6;
const MIN_EST_DT_MS = 15_000; // minst 15s för att minska jitter
const MIN_EST_DIST_KM = 0.05; // ignorera små hopp
const REUSE_EST_MS = 90_000; // återanvänd senaste est om vi saknar bra underlag

const MAX_SPEED_BY_PRODUCT = {
  "SL Pendeltåg": 170,
  "Pågatågen": 200,
  "Västtågen": 200,
  "Krösatågen": 180,
  "Tåg i Bergslagen": 200,
  "Värmlandstrafik": 200,
  "Arlanda Express": 220,
  "SJ InterCity": 200,
  "X-Tåget": 200,
  "Snälltåget": 230,
  "Norrtåg": 200,
};

function maxPlausibleSpeed(product) {
  return MAX_SPEED_BY_PRODUCT[product] ?? 250;
}

function pushSample(key, sample) {
  const arr = lastSamplesByKey.get(key) ?? [];
  const last = arr[arr.length - 1];

  // om timestamp är samma, ersätt senaste (minskar "fladder")
  if (last && last.tsMs === sample.tsMs) {
    arr[arr.length - 1] = sample;
  } else {
    arr.push(sample);
  }

  // trim
  while (arr.length > MAX_SAMPLES) arr.shift();
  lastSamplesByKey.set(key, arr);
  return arr;
}

function estimateSpeedFromSamples(key, product, current) {
  const arr = lastSamplesByKey.get(key);
  if (!arr || arr.length < 2) return null;

  // hitta en sample som är minst MIN_EST_DT_MS äldre än current
  const targetTs = current.tsMs - MIN_EST_DT_MS;
  let base = null;
  for (let i = arr.length - 2; i >= 0; i--) {
    if (arr[i].tsMs <= targetTs) {
      base = arr[i];
      break;
    }
  }
  if (!base) return null;

  const dtMs = current.tsMs - base.tsMs;
  if (dtMs <= 0) return null;

  const distKm = haversineKm(base.lat, base.lon, current.lat, current.lon);
  if (!Number.isFinite(distKm) || distKm < MIN_EST_DIST_KM) return null;

  const est = distKm / (dtMs / 3_600_000);
  if (!Number.isFinite(est) || est < 2) return null;

  const max = maxPlausibleSpeed(product);
  if (est > max * 1.35) return null;

  return Math.min(est, max);
}

function smoothEstimate(key, rawEst, tsMs) {
  const prev = lastEstSpeedByKey.get(key);
  if (prev && Number.isFinite(prev.speed) && tsMs - prev.tsMs <= REUSE_EST_MS) {
    return 0.65 * prev.speed + 0.35 * rawEst;
  }
  return rawEst;
}

function normalizeTrain(tIn) {
  const t = { ...tIn };

  // Product-display
  t.product = normalizeProduct(t.product);

  // Arlanda Express-regel
  const n = Number(t.trainNo);
  if (Number.isFinite(n) && n >= 7700 && n <= 7999) {
    t.product = "Arlanda Express";
    t.to = n % 2 === 1 ? "Stockholm C" : "Arlanda";
  }

  // SL Pendeltåg: "1 km/h" verkar vara default -> behandla som null
  if (t.product === "SL Pendeltåg" && t.speed === 1) {
    t.speed = null;
  }

  const key = `${t.depDate}_${t.trainNo}`;
  const tsMs = Date.parse(t.timeStamp ?? "");
  if (Number.isFinite(tsMs) && typeof t.lat === "number" && typeof t.lon === "number") {
    pushSample(key, { lat: t.lat, lon: t.lon, tsMs });
  }

  // Hastighetsestimat om null
  t._speedEstimated = false;
  if (t.speed === null || t.speed === undefined) {
    if (Number.isFinite(tsMs)) {
      const raw = estimateSpeedFromSamples(key, t.product, { lat: t.lat, lon: t.lon, tsMs });
      if (raw !== null) {
        const smoothed = smoothEstimate(key, raw, tsMs);
        t.speed = Math.round(smoothed);
        t._speedEstimated = true;
        lastEstSpeedByKey.set(key, { speed: t.speed, tsMs });
      } else {
        const prev = lastEstSpeedByKey.get(key);
        if (prev && Number.isFinite(prev.speed) && tsMs - prev.tsMs <= REUSE_EST_MS) {
          t.speed = prev.speed;
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
  const opacity = t.canceled ? 0.35 : 1;

  if (!markers.has(key)) {
    const marker = L.marker([t.lat, t.lon], {
      icon: makeTrainDivIcon({ color, bearing: t.bearing }),
      opacity,
    }).addTo(map);

    attachHoverAndClick(marker, key);
    markers.set(key, marker);
  } else {
    const marker = markers.get(key);

    // position animation (inkl label sync under animation)
    animateMarkerTo(key, marker, [t.lat, t.lon], 850);

    // icon update (bearing + color)
    marker.setIcon(makeTrainDivIcon({ color, bearing: t.bearing }));
    marker.setOpacity(opacity);

    // Om labeln är aktiv: uppdatera icon-text vid refresh (inte per frame)
    syncLabelIconIfNeeded(key, t);

    // Se till att glow är kvar om pinnad
    if (pinnedKey === key) {
      setGlow(marker, true);
    }
  }

  return key;
}

// ===== LOOP =====
async function refresh() {
  try {
    if (document.hidden) return; // spara CPU + data när fliken inte är aktiv
    const trains = await fetchTrains();
    const seen = new Set();

    for (const t of trains) {
      if (!t || !t.trainNo) continue;
      if (typeof t.lat !== "number" || typeof t.lon !== "number") continue;
      const key = upsertTrain(t);
      seen.add(key);
    }

    // remove gamla
    for (const [key, marker] of markers.entries()) {
      if (!seen.has(key)) {
        if (pinnedKey === key) clearPinnedLabel();
        if (hoverKey === key) clearHoverLabel();

        if (map.hasLayer(marker)) map.removeLayer(marker);
        markers.delete(key);
        trainDataByKey.delete(key);
        lastSamplesByKey.delete(key);
        lastEstSpeedByKey.delete(key);
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
  if (!document.hidden) {
    refresh();
  }
});

tick();
