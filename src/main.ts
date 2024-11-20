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
let playerCoins: Geocoin[] = [];

const playerMovementHistory: leaflet.LatLng[] = [];

let playerPoints = 0;
let playerPosition = OAKES_CLASSROOM;
let isGeolocationActive = false;
let watchId: number | null = null;

const eventDispatcher = new EventTarget();

const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;

const cacheStateMemento: { [key: string]: CacheMemento } = {};

const spawnedCaches = new Set<string>();
const sensorButton = document.getElementById("sensor")!;

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

interface CacheMemento {
  cellKey: string;
  coins: Geocoin[];
}

const createCell = (i: number, j: number): Cell => ({
  i,
  j,
  toLatLng: () => ({
    latitude: OAKES_CLASSROOM.lat + i * TILE_DEGREES,
    longitude: OAKES_CLASSROOM.lng + j * TILE_DEGREES,
  }),
  toString: () => `${i}:${j}`,
});

const geocoinFactory: GeocoinFactory = {
  coins: {},

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

function saveCacheState(cell: Cell) {
  const cellKey = cell.toString();
  const coins = geocoinFactory.getCoins(cell);
  cacheStateMemento[cellKey] = { cellKey, coins: [...coins] };
}

function restoreCacheState(cell: Cell): void {
  const cellKey = cell.toString();
  if (cacheStateMemento[cellKey]) {
    const savedState = cacheStateMemento[cellKey];
    geocoinFactory.coins[cellKey] = savedState.coins;
    spawnedCaches.add(cellKey);
  }
}

function spawnRelativeCache() {
  const { lat: playerLat, lng: playerLng } = playerPosition;
  const playerI = Math.round((playerLat - OAKES_CLASSROOM.lat) / TILE_DEGREES);
  const playerJ = Math.round((playerLng - OAKES_CLASSROOM.lng) / TILE_DEGREES);

  spawnedCaches.clear(); // Clear the spawned caches set

  for (
    let i = playerI - NEIGHBORHOOD_SIZE;
    i <= playerI + NEIGHBORHOOD_SIZE;
    i++
  ) {
    for (
      let j = playerJ - NEIGHBORHOOD_SIZE;
      j <= playerJ + NEIGHBORHOOD_SIZE;
      j++
    ) {
      const cell = createCell(i, j);
      const cellKey = cell.toString();

      // Check if the cache exists in Memento
      if (cacheStateMemento[cellKey]) {
        restoreCacheState(cell);
      } else if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
        spawnCache(i, j);
        saveCacheState(cell);
      }
    }
  }
}

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
    spawnRelativeCache();
    updatePlayerMovementHistory(); // Update the movement history
  }
}

eventDispatcher.addEventListener("game-state-changed", updateStatusPanel);

const directions = ["north", "south", "east", "west"];

directions.forEach((direction) => {
  document.getElementById(direction)?.addEventListener(
    "click",
    () => movePlayer(direction),
  );
});

function updatePlayerPositionFromGeolocation(position: GeolocationPosition) {
  const { latitude, longitude } = position.coords;

  playerPosition = leaflet.latLng(latitude, longitude);
  playerMarker.setLatLng(playerPosition);
  map.panTo(playerPosition);

  spawnRelativeCache();
}

function startGeolocationTracking() {
  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      updatePlayerPositionFromGeolocation,
      (error) => {
        alert(`Geolocation error: ${error.message}`);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 5000,
      },
    );
  } else {
    alert("Geolocation is not supported by this browser.");
  }
}

function stopGeolocationTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

function toggleGeolocationTracking() {
  if (isGeolocationActive) {
    stopGeolocationTracking();
    isGeolocationActive = false;
    sensorButton.style.backgroundColor = "";
  } else {
    startGeolocationTracking();
    isGeolocationActive = true;
    sensorButton.style.backgroundColor = "lightgreen";
  }
}

function savePlayerState() {
  const playerState = {
    position: { lat: playerPosition.lat, lng: playerPosition.lng },
    coins: playerCoins.map((coin) => ({
      latitude: coin.latitude,
      longitude: coin.longitude,
      serial: coin.serial,
      collected: coin.collected,
    })),
    movementHistory: playerMovementHistory.map((latLng) => ({
      lat: latLng.lat,
      lng: latLng.lng,
    })),
  };

  // Save the player state to localStorage
  localStorage.setItem("playerState", JSON.stringify(playerState));

  console.log("Player state saved", playerState);
}

function loadPlayerState() {
  const savedPlayerState = localStorage.getItem("playerState");
  if (savedPlayerState) {
    const playerState = JSON.parse(savedPlayerState);
    playerPosition = leaflet.latLng(
      playerState.position.lat,
      playerState.position.lng,
    );
    playerCoins = playerState.coins.map((coin: Geocoin) => ({
      latitude: coin.latitude,
      longitude: coin.longitude,
      serial: coin.serial,
      collected: coin.collected,
      collect: function () {
        if (!this.collected) {
          this.collected = true;
          playerCoins.push(this);
          playerPoints += 1;
          eventDispatcher.dispatchEvent(new Event("game-state-changed"));
        }
      },
    }));
    playerMarker.setLatLng(playerPosition);
    map.panTo(playerPosition);
  }

  // Load cache state from localStorage
  const savedCacheState = localStorage.getItem("cacheState");
  if (savedCacheState) {
    const cacheState = JSON.parse(savedCacheState);
    cacheState.forEach((cache: CacheMemento) => {
      geocoinFactory.coins[cache.cellKey] = cache.coins;
      spawnedCaches.add(cache.cellKey);
    });
  }
}

// function clearSavedData() {
//   localStorage.removeItem("playerState");
//   localStorage.removeItem("cacheState");
// }

function updatePlayerMovementHistory() {
  playerMovementHistory.push(playerPosition);
  const polyline = leaflet.polyline(playerMovementHistory, { color: "red" })
    .addTo(map);
  map.fitBounds(polyline.getBounds()); // Optionally zoom to fit the polyline bounds
}

eventDispatcher.addEventListener("game-state-changed", savePlayerState);

sensorButton.addEventListener("click", toggleGeolocationTracking);

setInterval(savePlayerState, 100);

loadPlayerState();
updateStatusPanel();
spawnRelativeCache();
