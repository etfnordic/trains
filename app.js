// ==========================
// 1) KONFIG
// ==========================

// ÄNDRA DENNA till din worker-endpoint:
const WORKER_URL = "https://trains.etfnordic.workers.dev/trains";

// Hur ofta vi uppdaterar (ms)
const REFRESH_MS = 5000;

// Färgkarta per product.
// Lägg bara till fler rader här när du upptäcker nya "product"-värden.
const PRODUCT_COLORS = {
  "Pågatågen": "#A855F7",     // lila
  "Västtågen": "#2563EB",     // blå
  "SJ InterCity": "#0EA5E9",
  "X-Tåget": "#F97316",
  "Snälltåget": "#22C55E",
  "SL Pendeltåg": "#0EA5E9",
  "Norrtåg": "#F43F5E",
};

// fallback om product saknas i listan
const DEFAULT_COLOR = "#64748B"; // slate

// ==========================
// 2) KARTA
// ==========================
const map = L.map("map", { zoomControl: true }).setView([59.33, 18.06], 6);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

// ==========================
// 3) STATE
// ==========================
/**
 * markers: Map<key, L.Marker>
 * key kan vara trainNo, men om du får krockar över dagar kan du använda `${depDate}_${trainNo}`
 */
const markers = new Map();

let pinnedKey = null; // vilket tåg som är “fastnålat” (chip visas permanent)

// Klick på karta => släpp pin
map.on("click", () => {
  pinnedKey = null;
  // stäng alla tooltips som inte hovras
  markers.forEach((m) => m.closeTooltip());
});

// ==========================
// 4) HJÄLPFUNKTIONER
// ==========================
function colorForProduct(product) {
  return PRODUCT_COLORS[product] ?? DEFAULT_COLOR;
}

function formatChipText(t) {
  // Exempel: "Västtågen 3084 → Göteborg C · 57 km/h"
  const base = `${t.product} ${t.trainNo} \u2192 ${t.to}`; // → (högerpil)
  if (t.speed === null || t.speed === undefined) return base;
  return `${base} \u00B7 ${t.speed} km/h`; // ·
}

function makeArrowSvg(color) {
  // Din location-arrow.svg fast inline för att kunna färgsätta + skala snabbt.
  // Stroke = color (likt din pil)
  return `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.36328 12.0523C4.01081 11.5711 3.33457 11.3304 3.13309 10.9655C2.95849 10.6492 2.95032 10.2673 3.11124 9.94388C3.29694 9.57063 3.96228 9.30132 5.29295 8.76272L17.8356 3.68594C19.1461 3.15547 19.8014 2.89024 20.2154 3.02623C20.5747 3.14427 20.8565 3.42608 20.9746 3.7854C21.1106 4.19937 20.8453 4.85465 20.3149 6.16521L15.2381 18.7078C14.6995 20.0385 14.4302 20.7039 14.0569 20.8896C13.7335 21.0505 13.3516 21.0423 13.0353 20.8677C12.6704 20.6662 12.4297 19.99 11.9485 18.6375L10.4751 14.4967C10.3815 14.2336 10.3347 14.102 10.2582 13.9922C10.1905 13.8948 10.106 13.8103 10.0086 13.7426C9.89876 13.6661 9.76719 13.6193 9.50407 13.5257L5.36328 12.0523Z"
        stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

function makeTrainDivIcon({ color, bearing }) {
  const html = `
    <div class="train-icon" style="transform: rotate(${bearing ?? 0}deg);">
      ${makeArrowSvg(color)}
    </div>
  `;

  return L.divIcon({
    className: "", // vi styr allt själva
    html,
    iconSize: [34, 34],
    iconAnchor: [17, 17], // center
  });
}

function bindChip(marker, t, color, key) {
  const text = formatChipText(t);

  // Tooltip-innehåll: chip med samma färg som pilen
  const chipHtml = `
    <div class="chip" style="background:${color};">
      <span class="pill">${t.trainNo}</span>
      <span>${text}</span>
    </div>
  `;

  marker.bindTooltip(chipHtml, {
    direction: "top",
    offset: [0, -18],
    opacity: 1,
    className: "train-chip",
    permanent: false,
    interactive: true,
  });

  // Hover => visa chip om inte något annat är pinnat
  marker.on("mouseover", () => {
    if (pinnedKey === null || pinnedKey === key) marker.openTooltip();
  });

  marker.on("mouseout", () => {
    // Stäng om den inte är pinnad
    if (pinnedKey !== key) marker.closeTooltip();
  });

  // Klick => “fäst” chipet
  marker.on("click", (e) => {
    L.DomEvent.stopPropagation(e); // så kartklick inte triggas
    pinnedKey = key;
    marker.openTooltip();
  });
}

function upsertTrain(t) {
  const key = `${t.depDate}_${t.trainNo}`; // robust mot krockar
  const color = colorForProduct(t.product);

  // om cancelled: tona ned lite
  const opacity = t.canceled ? 0.35 : 1;

  if (!markers.has(key)) {
    const icon = makeTrainDivIcon({ color, bearing: t.bearing });
    const marker = L.marker([t.lat, t.lon], { icon, opacity }).addTo(map);

    bindChip(marker, t, color, key);
    markers.set(key, marker);
  } else {
    const marker = markers.get(key);

    // Uppdatera position + opacity
    marker.setLatLng([t.lat, t.lon]);
    marker.setOpacity(opacity);

    // Uppdatera ikon (färg + rotation + ev product-ändring)
    marker.setIcon(makeTrainDivIcon({ color, bearing: t.bearing }));

    // Uppdatera tooltip-text
    const chipHtml = `
      <div class="chip" style="background:${color};">
        <span class="pill">${t.trainNo}</span>
        <span>${formatChipText(t)}</span>
      </div>
    `;
    marker.setTooltipContent(chipHtml);

    // Om pinnad, håll den öppen
    if (pinnedKey === key) marker.openTooltip();
  }

  return key;
}

// ==========================
// 5) HÄMTA & RITA
// ==========================
async function fetchTrains() {
  const res = await fetch(WORKER_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();

  // Din worker: { meta: {...}, trains: [...] }
  if (Array.isArray(data)) return data;              // om du någon gång byter format
  if (Array.isArray(data.trains)) return data.trains;

  return [];
}

async function refresh() {
  try {
    const trains = await fetchTrains();

    // Håll koll på vilka som finns i senaste pullen
    const seen = new Set();

    for (const t of trains) {
      // säkerhetskoll om något saknas
      if (typeof t.lat !== "number" || typeof t.lon !== "number") continue;
      if (!t.trainNo) continue;

      const key = upsertTrain(t);
      seen.add(key);
    }

    // Ta bort markers som inte längre rapporteras
    for (const [key, marker] of markers.entries()) {
      if (!seen.has(key)) {
        if (pinnedKey === key) pinnedKey = null;
        map.removeLayer(marker);
        markers.delete(key);
      }
    }
  } catch (err) {
    console.error("Kunde inte uppdatera tåg:", err);
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
