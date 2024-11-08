import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import "./leafletWorkaround.ts";
import luck from "./luck.ts";

const OAKES_CLASSROOM = leaflet.latLng(36.98949379578401, -122.06277128548504);
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;

const playerCoins: Geocoin[] = [];
let playerPoints = 0;

const eventDispatcher = new EventTarget();

const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;
updateStatusPanel();

function updateStatusPanel() {
  const inventoryText = playerCoins
    .map((coin) => `${coin.latitude}:${coin.longitude}#${coin.serial}`)
    .join("<br>");
  const newStatus = `Points: ${playerPoints}<br>Inventory:<br>${inventoryText}`;

  if (statusPanel.innerHTML !== newStatus) {
    statusPanel.innerHTML = newStatus;
  }
}

eventDispatcher.addEventListener("game-state-changed", updateStatusPanel);

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
    maxZoom: 19,
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

class ConcreteCell implements Cell {
  constructor(public i: number, public j: number) {}

  static fromLatLng(lat: number, lng: number): ConcreteCell {
    const i = Math.floor(lat / TILE_DEGREES);
    const j = Math.floor(lng / TILE_DEGREES);
    return new ConcreteCell(i, j);
  }

  toLatLng(): { latitude: number; longitude: number } {
    return {
      latitude: this.i * TILE_DEGREES,
      longitude: this.j * TILE_DEGREES,
    };
  }

  toString(): string {
    return `${this.i}:${this.j}`;
  }
}

interface Geocoin {
  latitude: number;
  longitude: number;
  serial: number;
  collected: boolean;
  collect(): void;
}

class GeocoinFactory {
  private static coins: { [key: string]: Geocoin[] } = {};

  static create(cell: Cell): Geocoin {
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
  }

  static getCoins(cell: Cell): Geocoin[] {
    const cellKey = cell.toString();
    return this.coins[cellKey] || [];
  }

  static removeCoin(cell: Cell, coin: Geocoin): void {
    const cellKey = cell.toString();
    const coinIndex = this.coins[cellKey]?.indexOf(coin);
    if (coinIndex !== undefined && coinIndex !== -1) {
      this.coins[cellKey].splice(coinIndex, 1);
    }
  }

  static addCoinToCache(cell: Cell, coin: Geocoin): void {
    const cellKey = cell.toString();
    if (!this.coins[cellKey]) {
      this.coins[cellKey] = [];
    }
    this.coins[cellKey].push(coin);
  }
}

const spawnedCaches = new Set<string>();

function spawnCache(i: number, j: number) {
  const cell = new ConcreteCell(i, j);
  const origin = OAKES_CLASSROOM;
  const bounds = leaflet.latLngBounds([
    [origin.lat + i * TILE_DEGREES, origin.lng + j * TILE_DEGREES],
    [origin.lat + (i + 1) * TILE_DEGREES, origin.lng + (j + 1) * TILE_DEGREES],
  ]);

  const rect = leaflet.rectangle(bounds);
  rect.addTo(map);

  rect.bindPopup(() => {
    const cellKey = cell.toString();
    if (!spawnedCaches.has(cellKey)) {
      const coinCount = Math.floor(luck([i, j, "coinCount"].toString()) * 10) +
        1;
      for (let c = 0; c < coinCount; c++) {
        GeocoinFactory.create(cell);
      }
      spawnedCaches.add(cellKey);
      eventDispatcher.dispatchEvent(new Event("game-state-changed"));
    }

    const coins = GeocoinFactory.getCoins(cell);
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `<div>Cache at "${cell.toString()}":</div>`;

    coins.forEach((coin, index) => {
      const coinDiv = document.createElement("div");
      if (!coin.collected) {
        coinDiv.innerHTML = `
          <div>(${coin.latitude}:${coin.longitude}#${coin.serial})
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
    depositButton.addEventListener("click", () => {
      if (playerCoins.length > 0) {
        const depositedCoin = playerCoins.pop()!;

        depositedCoin.collected = false;
        playerPoints -= 1;

        GeocoinFactory.removeCoin(cell, depositedCoin);
        GeocoinFactory.addCoinToCache(cell, depositedCoin);

        eventDispatcher.dispatchEvent(new Event("game-state-changed"));
        rect.openPopup();
      } else {
        alert("No coins to deposit!");
      }
    });
    popupDiv.appendChild(depositDiv);

    return popupDiv;
  });
}

for (let i = -NEIGHBORHOOD_SIZE; i < NEIGHBORHOOD_SIZE; i++) {
  for (let j = -NEIGHBORHOOD_SIZE; j < NEIGHBORHOOD_SIZE; j++) {
    if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
      spawnCache(i, j);
    }
  }
}
