import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import "./leafletWorkaround.ts";
import luck from "./luck.ts";

// Constants
const OAKES_CLASSROOM = leaflet.latLng(36.98949379578401, -122.06277128548504);
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4; // Smaller step for better precision
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;
const MAX_ZOOM = 19;

// Player state
const playerCoins: Geocoin[] = [];
let playerPoints = 0;

const eventDispatcher = new EventTarget();
const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;
updateStatusPanel();

interface Cell {
  i: number;
  j: number;
  toLatLng(): { latitude: number; longitude: number };
  toString(): string;
}

interface Geocoin {
  latitude: number;
  longitude: number;
  serial: number;
  collected: boolean;
  collect(): void;
}

interface GeocoinFactory {
  coins: { [key: string]: Geocoin[] };
  create(cell: Cell): Geocoin;
  getCoins(cell: Cell): Geocoin[];
  removeCoin(cell: Cell, coin: Geocoin): void;
  addCoinToCache(cell: Cell, coin: Geocoin): void;
}

// Update the status panel with the latest player state
function updateStatusPanel() {
  const inventoryText = playerCoins
    .map((coin) =>
      `${coin.latitude.toFixed(5)}:${coin.longitude.toFixed(5)}#${coin.serial}`
    )
    .join("<br>");
  const newStatus = `Points: ${playerPoints}<br>Inventory:<br>${inventoryText}`;

  if (statusPanel.innerHTML !== newStatus) {
    statusPanel.innerHTML = newStatus;
  }
}

eventDispatcher.addEventListener("game-state-changed", updateStatusPanel);

// Map setup
const map = leaflet.map(document.getElementById("map")!, {
  center: OAKES_CLASSROOM,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
});

leaflet
  .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: MAX_ZOOM,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  })
  .addTo(map);

const playerMarker = leaflet.marker(OAKES_CLASSROOM);
playerMarker.bindTooltip("That's you!");
playerMarker.addTo(map);

// Utility functions to simplify repetitive code
const createCell = (i: number, j: number): Cell => ({
  i,
  j,
  toLatLng: () => ({
    latitude: OAKES_CLASSROOM.lat + i * TILE_DEGREES,
    longitude: OAKES_CLASSROOM.lng + j * TILE_DEGREES,
  }),
  toString: () => `${i}:${j}`,
});

// Geocoin factory object
const geocoinFactory: GeocoinFactory = {
  coins: {}, // Initialize coins as an empty object

  create(cell: Cell): Geocoin {
    const cellKey = cell.toString();
    const serial = this.coins[cellKey]?.length ?? 0;
    const { latitude, longitude } = cell.toLatLng();

    const geocoin: Geocoin = {
      latitude,
      longitude,
      serial,
      collected: false,
      collect: function () {
        if (!this.collected) {
          this.collected = true;
          playerCoins.push(this);
          playerPoints += 1;
          eventDispatcher.dispatchEvent(new Event("game-state-changed"));
        }
      },
    };

    if (!this.coins[cellKey]) {
      this.coins[cellKey] = [];
    }
    this.coins[cellKey].push(geocoin);
    return geocoin;
  },

  getCoins(cell: Cell): Geocoin[] {
    return this.coins[cell.toString()] || [];
  },

  removeCoin(cell: Cell, coin: Geocoin): void {
    const cellKey = cell.toString();
    const coinIndex = this.coins[cellKey]?.indexOf(coin);
    if (coinIndex !== -1) {
      this.coins[cellKey].splice(coinIndex, 1);
    }
  },

  addCoinToCache(cell: Cell, coin: Geocoin): void {
    const cellKey = cell.toString();
    if (!this.coins[cellKey]) {
      this.coins[cellKey] = [];
    }
    this.coins[cellKey].push(coin);
  },
};

const spawnedCaches = new Set<string>();

// Function to spawn caches on the map
function spawnCache(i: number, j: number) {
  const cell = createCell(i, j);
  const bounds = getCacheBounds(i, j);
  const rect = leaflet.rectangle(bounds);
  rect.addTo(map);

  rect.bindPopup(() => generatePopupContent(cell, rect));
}

// Generate bounds for cache based on position
function getCacheBounds(i: number, j: number) {
  const origin = OAKES_CLASSROOM;
  return leaflet.latLngBounds([
    [origin.lat + i * TILE_DEGREES, origin.lng + j * TILE_DEGREES],
    [origin.lat + (i + 1) * TILE_DEGREES, origin.lng + (j + 1) * TILE_DEGREES],
  ]);
}

// Generate the popup content for a cache
function generatePopupContent(cell: Cell, rect: leaflet.Rectangle) {
  const cellKey = cell.toString();
  if (!spawnedCaches.has(cellKey)) {
    const coinCount =
      Math.floor(luck([cell.i, cell.j, "coinCount"].toString()) * 10) + 1;
    for (let c = 0; c < coinCount; c++) {
      geocoinFactory.create(cell);
    }
    spawnedCaches.add(cellKey);
    eventDispatcher.dispatchEvent(new Event("game-state-changed"));
  }

  const coins = geocoinFactory.getCoins(cell);
  const popupDiv = document.createElement("div");

  // Display cache coordinates in the desired format
  const { latitude, longitude } = cell.toLatLng();
  popupDiv.innerHTML = `<div>Cache at "${latitude.toFixed(5)}:${
    longitude.toFixed(5)
  }"</div>`;

  coins.forEach((coin, index) => {
    const coinDiv = document.createElement("div");
    if (!coin.collected) {
      coinDiv.innerHTML = `
        <div>(${coin.latitude.toFixed(5)}:${
        coin.longitude.toFixed(5)
      }#${coin.serial})
          <button id="collect-${index}">Collect</button>
        </div>
      `;
      const collectButton = coinDiv.querySelector(`#collect-${index}`)!;
      collectButton.addEventListener("click", () => {
        coin.collect();
        coinDiv.innerHTML = ``;
      });
    }
    popupDiv.appendChild(coinDiv);
  });

  const depositDiv = document.createElement("div");
  depositDiv.innerHTML = `<button id="deposit">Deposit a coin</button>`;
  const depositButton = depositDiv.querySelector("#deposit")!;
  depositButton.addEventListener("click", () => handleCoinDeposit(cell, rect));
  popupDiv.appendChild(depositDiv);

  return popupDiv;
}

// Handle coin deposit logic
function handleCoinDeposit(cell: Cell, rect: leaflet.Rectangle) {
  if (playerCoins.length > 0) {
    const depositedCoin = playerCoins.pop()!;
    depositedCoin.collected = false;
    playerPoints -= 1;
    geocoinFactory.removeCoin(cell, depositedCoin);
    geocoinFactory.addCoinToCache(cell, depositedCoin);
    eventDispatcher.dispatchEvent(new Event("game-state-changed"));
    rect.openPopup();
  } else {
    alert("No coins to deposit!");
  }
}

// Spawn caches around the neighborhood
for (let i = -NEIGHBORHOOD_SIZE; i < NEIGHBORHOOD_SIZE; i++) {
  for (let j = -NEIGHBORHOOD_SIZE; j < NEIGHBORHOOD_SIZE; j++) {
    if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
      spawnCache(i, j);
    }
  }
}

// Player movement logic
let playerPosition = OAKES_CLASSROOM;

function movePlayer(direction: string) {
  const movement: { [key: string]: leaflet.LatLng } = {
    north: leaflet.latLng(
      playerPosition.lat + TILE_DEGREES,
      playerPosition.lng,
    ),
    south: leaflet.latLng(
      playerPosition.lat - TILE_DEGREES,
      playerPosition.lng,
    ),
    east: leaflet.latLng(playerPosition.lat, playerPosition.lng + TILE_DEGREES),
    west: leaflet.latLng(playerPosition.lat, playerPosition.lng - TILE_DEGREES),
  };

  if (movement[direction]) {
    playerPosition = movement[direction];
    playerMarker.setLatLng(playerPosition);
    map.panTo(playerPosition);
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp") movePlayer("north");
  else if (event.key === "ArrowDown") movePlayer("south");
  else if (event.key === "ArrowRight") movePlayer("east");
  else if (event.key === "ArrowLeft") movePlayer("west");
});
