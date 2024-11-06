import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import "./leafletWorkaround.ts";
import luck from "./luck.ts";

// Location of our classroom (as identified on Google Maps)
const OAKES_CLASSROOM = leaflet.latLng(36.98949379578401, -122.06277128548504);

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;

// Player inventory
let playerCoins = 0;
let playerPoints = 0;

// Create the map (element with id "map" is defined in index.html)
const map = leaflet.map(document.getElementById("map")!, {
  center: OAKES_CLASSROOM,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
});

// Populate the map with a background tile layer
leaflet
  .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  })
  .addTo(map);

// Add a marker to represent the player
const playerMarker = leaflet.marker(OAKES_CLASSROOM);
playerMarker.bindTooltip("That's you!");
playerMarker.addTo(map);

// Display the player's points and coins in the status panel
const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;
updateStatusPanel();

// Function to update the status panel
function updateStatusPanel() {
  statusPanel.innerHTML = `Coins: ${playerCoins} | Points: ${playerPoints}`;
}

// Add caches to the map by cell numbers
function spawnCache(i: number, j: number) {
  // Convert cell numbers into lat/lng bounds
  const origin = OAKES_CLASSROOM;
  const bounds = leaflet.latLngBounds([
    [origin.lat + i * TILE_DEGREES, origin.lng + j * TILE_DEGREES],
    [origin.lat + (i + 1) * TILE_DEGREES, origin.lng + (j + 1) * TILE_DEGREES],
  ]);

  // Add a rectangle to the map to represent the cache
  const rect = leaflet.rectangle(bounds);
  rect.addTo(map);

  // Handle interactions with the cache
  rect.bindPopup(() => {
    // Each cache has a random point value and coin count
    let pointValue = Math.floor(luck([i, j, "initialValue"].toString()) * 100);
    let coinCount = Math.floor(luck([i, j, "coinCount"].toString()) * 10) + 1;

    // The popup offers a description and buttons for collecting and depositing
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
                <div>Cache at "${i},${j}". Value: <span id="value">${pointValue}</span>, Coins: <span id="coin-count">${coinCount}</span>.</div>
                <button id="collect">Collect</button>
                <button id="deposit">Deposit</button>
                <button id="poke">Poke</button>`;

    const valueElement = popupDiv.querySelector<HTMLSpanElement>("#value")!;
    const coinCountElement = popupDiv.querySelector<HTMLSpanElement>(
      "#coin-count",
    )!;
    const collectButton = popupDiv.querySelector<HTMLButtonElement>(
      "#collect",
    )!;
    const depositButton = popupDiv.querySelector<HTMLButtonElement>(
      "#deposit",
    )!;
    const pokeButton = popupDiv.querySelector<HTMLButtonElement>("#poke")!;

    // Collect all coins from the cache
    collectButton.addEventListener("click", () => {
      if (coinCount > 0) {
        playerCoins += coinCount;
        playerPoints += coinCount;
        coinCount = 0;
        updateStatusPanel();
        coinCountElement.innerHTML = coinCount.toString();
      }
    });

    // Deposit 1 coin into the cache
    depositButton.addEventListener("click", () => {
      if (playerCoins > 0) {
        playerCoins--;
        playerPoints++;
        coinCount++;
        updateStatusPanel();
        coinCountElement.innerHTML = coinCount.toString();
      }
    });

    // Increase points through "poke"
    pokeButton.addEventListener("click", () => {
      pointValue--;
      playerPoints++;
      updateStatusPanel();
      valueElement.innerHTML = pointValue.toString();
    });

    return popupDiv;
  });
}

// Look around the player's neighborhood for caches to spawn
for (let i = -NEIGHBORHOOD_SIZE; i < NEIGHBORHOOD_SIZE; i++) {
  for (let j = -NEIGHBORHOOD_SIZE; j < NEIGHBORHOOD_SIZE; j++) {
    // If location i,j is lucky enough, spawn a cache!
    if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
      spawnCache(i, j);
    }
  }
}
