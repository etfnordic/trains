const WORKER_URL = "https://trains.etfnordic.workers.dev/trains";
const REFRESH_MS = 5000;

const PRODUCT_COLORS = {
  "Pågatågen": "#A855F7",
  "Västtågen": "#2563EB",
  "Krösatågen": "#F59E0B",
  "TiB": "#10B981",
  "SJ InterCity": "#0EA5E9",
  "X-Tåget": "#F97316",
  "Snälltåget": "#22C55E",
  "SL Pendeltåg": "#0EA5E9",
  "Norrtåg": "#F43F5E",
};
const DEFAULT_COLOR = "#64748B";

// ===== KARTA =====
const map = L.map("map", { zoomControl: true }).setView([59.33, 18.06], 6);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

// ===== STATE =====
const markers = new Map();         // key -> marker
const trainDataByKey = new Map();  // key -> train
let pinnedKey = null;

let filterQuery = "";

// Släpp pin på kartklick (snabbt)
map.on("click", () => {
  unpinCurrent();
});

// ===== SÖK =====
const searchEl = document.getElementById("search");
const clearBtn = document.getElementById("clearSearch");

function normalize(s) {
  return String(s ?? "").toLowerCase().trim();
}

function matchesFilter(t) {
  if (!filterQuery) return true;
  const hay = `${t.trainNo} ${t.operator} ${t.to}`.toLowerCase();
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
      if (pinnedKey === key) pinnedKey = null;
    }
  }

  // 2) auto-zoom om exakt 1 match
  if (filterQuery && matchKeys.length === 1) {
    const key = matchKeys[0];
    const marker = markers.get(key);
    if (marker) {
      // passa in lite tajt, men utan att bli för nära
      const ll = marker.getLatLng();
      map.setView(ll, Math.max(map.getZoom(), 10), { animate: true });

      // visa chip även om inget är pinnat
      marker.openTooltip();
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
    applyFilterAndMaybeZoom();
  }, 120),
);

clearBtn.addEventListener("click", () => {
  searchEl.value = "";
  filterQuery = "";
  applyFilterAndMaybeZoom();
  searchEl.focus();
});

// ===== HELPERS =====
function colorForProduct(product) {
  return PRODUCT_COLORS[product] ?? DEFAULT_COLOR;
}

// Bearing offset: DU SA “mitt emellan nu och innan”.
// Innan: 0 offset (pekade höger). Sen: -90 (blev fel åt andra hållet).
// “Mittemellan” = -45. Du kan fintrimma här om du vill (+/- 10).
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
  return `${base} \u00B7 ${t.speed} km/h`;
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
  return `
    <div class="chip" style="background:${color};">
      <img class="logo" src="${logo}" alt="${t.product}" onerror="this.style.display='none'">
      <span>${formatChipText(t)}</span>
    </div>
  `;
}

// ===== Smooth move =====
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function animateMarkerTo(marker, toLatLng, durationMs = 850) {
  const from = marker.getLatLng();
  const to = L.latLng(toLatLng[0], toLatLng[1]);
  const start = performance.now();

  function step(now) {
    const t = Math.min(1, (now - start) / durationMs);
    marker.setLatLng([lerp(from.lat, to.lat, t), lerp(from.lng, to.lng, t)]);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ===== PIN/UNPIN utan lagg =====
//
// Vi gör “pin” genom att:
// - stänga tidigare pinnad tooltip
// - toggla CSS glow via marker.getElement().classList
// - göra tooltip “permanent” endast för pinnad marker
//
// Rebind sker bara för 2 markers (förra + nya), det håller det snabbt.
function setGlow(marker, on) {
  const el = marker.getElement();
  if (!el) return;
  el.classList.toggle("train-selected", on);
}

function bindTooltip(marker, t, color, permanent) {
  marker.unbindTooltip();
  marker.bindTooltip(chipHtml(t, color), {
    direction: "top",
    offset: [0, -18],
    opacity: 1,
    className: "train-chip",
    permanent,
    interactive: true,
  });
}

function unpinCurrent() {
  if (!pinnedKey) return;
  const prev = markers.get(pinnedKey);
  const t = trainDataByKey.get(pinnedKey);
  if (prev && t) {
    setGlow(prev, false);
    // gör den non-permanent igen
    bindTooltip(prev, t, colorForProduct(t.product), false);
    prev.closeTooltip();
  }
  pinnedKey = null;
}

function pinMarker(key) {
  if (pinnedKey === key) return; // redan pinnad

  // släpp tidigare direkt
  unpinCurrent();

  const marker = markers.get(key);
  const t = trainDataByKey.get(key);
  if (!marker || !t) return;

  pinnedKey = key;
  setGlow(marker, true);

  // gör tooltip permanent direkt (känns “instant”)
  bindTooltip(marker, t, colorForProduct(t.product), true);
  marker.openTooltip();
}

// Hover-beteende: vi låter Leaflet visa tooltip (non-permanent),
// men om den är pinnad så är den redan permanent.
function attachHoverAndClick(marker, key) {
  marker.on("mouseover", () => {
    if (!pinnedKey) marker.openTooltip();
  });

  marker.on("mouseout", () => {
    if (!pinnedKey) marker.closeTooltip();
  });

  marker.on("click", (e) => {
    L.DomEvent.stop(e);
    // Pin direkt utan extra logik som triggar re-render
    pinMarker(key);
  });
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
  const key = `${t.depDate}_${t.trainNo}`;
  trainDataByKey.set(key, t);

  const color = colorForProduct(t.product);
  const opacity = t.canceled ? 0.35 : 1;

  if (!markers.has(key)) {
    const marker = L.marker([t.lat, t.lon], {
      icon: makeTrainDivIcon({ color, bearing: t.bearing }),
      opacity,
    }).addTo(map);

    // init tooltip non-permanent
    bindTooltip(marker, t, color, false);
    attachHoverAndClick(marker, key);

    markers.set(key, marker);
  } else {
    const marker = markers.get(key);

    // position animation
    animateMarkerTo(marker, [t.lat, t.lon], 850);

    // icon update (bearing + color) — sker bara vid refresh, inte vid click
    marker.setIcon(makeTrainDivIcon({ color, bearing: t.bearing }));
    marker.setOpacity(opacity);

    // uppdatera tooltip-content, behåll permanent om pinnad
    const isPinned = pinnedKey === key;
    bindTooltip(marker, t, color, isPinned);

    if (isPinned) {
      setGlow(marker, true);
      marker.openTooltip();
    }
  }

  return key;
}

// ===== LOOP =====
async function refresh() {
  try {
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
        if (pinnedKey === key) pinnedKey = null;
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

refresh();
setInterval(refresh, REFRESH_MS);
