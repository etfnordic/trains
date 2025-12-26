const statusEl = document.getElementById("status");

const map = L.map("map").setView([59.3293, 18.0686], 6); // Sverige
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

statusEl.textContent = "Kartan är laddad.";
