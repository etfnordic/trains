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
  "SJ InterCity": "#AEAEAE",
  "SJ Snabbtåg": "#AEAEAE",
  "SJ Regional": "#AEAEAE",
  "Vy Snabbtåg": "#01775F",
  "Vy": "#01775F",
  "X-Tåget": "#F43F5E",
  "Snälltåget": "#51FF00",
  "SL Pendeltåg": "#00ADF0",
  "Norrtåg": "#20396C",
  "Östgötapendel": "#ED1B24",
  "Tågab": "#95623E",
  "Öresundståg": "#64748B",
  "VR Snabbtåg": "#00B451",
  "Mälartåg": "#0049A6",
};
const DEFAULT_COLOR = "#FFFFFF";

/* =========================================================
   FÖRSENINGSFÄRGER (justera hex här efter smak)
   - i tid / 1 min sen: GRÖN
   - 2–5 min: GUL
   - 6–10 min: ORANGE
   - 11–15 min: RÖD
   - 16+ min: VINRÖD
   ========================================================= */
const DELAY_COLOR_ON_TIME = "#22C55E"; // grön
const DELAY_COLOR_YELLOW  = "#FACC15"; // gul
const DELAY_COLOR_ORANGE  = "#F97316"; // orange
const DELAY_COLOR_RED     = "#EF4444"; // röd
const DELAY_COLOR_MAROON  = "#7F1D1D"; // vinröd

function delayBucketColor(mins) {
  // mins kan vara negativ/0 (tidig/i tid)
  if (mins <= 1) return DELAY_COLOR_ON_TIME;
  if (mins <= 5) return DELAY_COLOR_YELLOW;
  if (mins <= 10) return DELAY_COLOR_ORANGE;
  if (mins <= 15) return DELAY_COLOR_RED;
  return DELAY_COLOR_MAROON;
}

// ===== KARTA =====
const map = L.map("map", { zoomControl: true }).setView([59.33, 18.06], 6);
const baseHot = L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
    'Tiles style by <a href="https://www.hotosm.org/">Humanitarian OpenStreetMap Team</a>',
}).addTo(map);

// ===== RAIL OVERLAY (OpenRailwayMap) =====
map.createPane("railsPane");
map.getPane("railsPane").style.zIndex = 350;

L.tileLayer("https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png", {
  maxZoom: 19,
  pane: "railsPane",
  opacity: 0.55,
  attribution: "&copy; OpenRailwayMap (OSM-baserat)",
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
  if (userWatchId !== null) return;
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
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1500,
      timeout: 10000,
    },
  );
}

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

      btn.classList.add("is-following");
    });

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

ensureUserLocation();

// ===== STATE =====
const markers = new Map();
const trainDataByKey = new Map();

let hoverKey = null;
let hoverLabelMarker = null;

let pinnedKey = null;
let pinnedLabelMarker = null;

let isPointerOverTrain = false;

const LABEL_OFFSET_Y_PX = 18;

const lastKnownByTrainNo = new Map();
const LAST_KNOWN_TTL_MS = 30 * 60 * 1000;

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

function formatDelayHM(mins) {
  const sign = mins >= 0 ? "+" : "−";
  const m = Math.abs(mins);
  const h = Math.floor(m / 60);
  const mm = m % 60;

  if (h > 0) return `${sign}${h}:${String(mm).padStart(2, "0")}`;
  return `${sign}${mm}`;
}

function parseHHMM(s) {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function delayMinutes(t) {
  const sched = parseHHMM(t.atal);

  // använd tal om den finns, annars etal som fallback
  const actualStr = !isMissing(t.tal) ? t.tal : t.etal;
  const actual = parseHHMM(actualStr);

  if (sched === null || actual === null) return null;

  let d = actual - sched;

  // Midnattshantering (om differensen är "orimligt stor")
  if (d < -720) d += 1440;
  if (d > 720) d -= 1440;

  return d;
}

/**
 * Indikator:
 * - Om atal/tal ej går att tolka => visa inget
 * - <= 1 min sen (inkl tidig/i tid) => grön cirkel
 * - >= 2 min sen => "+N" badge med låsta färger
 */
function delayIndicatorHtml(t) {
  const dmin = delayMinutes(t);
  if (dmin === null) return "";

  if (dmin <= 1) {
    const c = DELAY_COLOR_ON_TIME;
    return `<span class="statusDot" style="background:${c}" title="I tid"></span>`;
  }

  const c = delayBucketColor(dmin);
  return `<span class="delayBadge" style="background:${c}" title="${dmin} min sen">${formatDelayHM(dmin)}</span>`;
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
  const indicator = delayIndicatorHtml(t);

  return `
    <div class="chip" style="background:${color}; color:${textColor};">
      <img class="logo" src="${logo}" alt="${t.product}" onerror="this.style.display='none'">
      <span>${formatChipText(t)}</span>
      ${indicator}
    </div>
  `;
}

// Label
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

const SPEED_CAP = 250;

function normalizeTrain(tIn) {
  const t = { ...tIn };

  t.product = normalizeProduct(t.product);

  const n = Number(t.trainNo);
  if (Number.isFinite(n) && n >= 7700 && n <= 7999) {
    t.product = "Arlanda Express";
    t.to = n % 2 === 1 ? "Stockholm C" : "Arlanda";
  }

  if (t.product === "SL Pendeltåg" && t.speed === 1) {
    t.speed = null;
  }

  if (isMissing(t.product)) t.product = null;
  if (isMissing(t.to)) t.to = null;

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

  if (t.speed !== null && t.speed !== undefined && Number.isFinite(Number(t.speed))) {
    t.speed = Math.min(Number(t.speed), SPEED_CAP);
  }

  t._speedEstimated = false;

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
