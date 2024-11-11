//written with the help of chatGPT
import leaflet from "leaflet";

export class Board {
  readonly tileWidth: number;
  readonly tileVisibilityRadius: number;

  private readonly knownCells: Map<string, Cell>;

  constructor(tileWidth: number, tileVisibilityRadius: number) {
    this.tileWidth = tileWidth;
    this.tileVisibilityRadius = tileVisibilityRadius;
    this.knownCells = new Map<string, Cell>();
  }

  private getCanonicalCell(cell: Cell): Cell {
    const key = cell.toString();
    if (!this.knownCells.has(key)) {
      this.knownCells.set(key, cell);
    }
    return this.knownCells.get(key)!;
  }

  getCellForPoint(point: leaflet.LatLng): Cell {
    const i = Math.floor(point.lat / this.tileWidth);
    const j = Math.floor(point.lng / this.tileWidth);
    const cell = new ConcreteCell(i, j);
    return this.getCanonicalCell(cell);
  }

  getCellBounds(cell: Cell): leaflet.LatLngBounds {
    const { latitude, longitude } = cell.toLatLng();
    const southWest = leaflet.latLng(latitude, longitude);
    const northEast = leaflet.latLng(
      latitude + this.tileWidth,
      longitude + this.tileWidth,
    );
    return leaflet.latLngBounds(southWest, northEast);
  }

  getCellsNearPoint(point: leaflet.LatLng): Cell[] {
    const resultCells: Cell[] = [];
    const originCell = this.getCellForPoint(point);

    for (
      let i = -this.tileVisibilityRadius;
      i <= this.tileVisibilityRadius;
      i++
    ) {
      for (
        let j = -this.tileVisibilityRadius;
        j <= this.tileVisibilityRadius;
        j++
      ) {
        const nearbyCell = new ConcreteCell(
          originCell.i + i,
          originCell.j + j,
        );
        resultCells.push(this.getCanonicalCell(nearbyCell));
      }
    }
    return resultCells;
  }
}

interface Cell {
  i: number;
  j: number;
  toLatLng(): { latitude: number; longitude: number };
  toString(): string;
}

export class ConcreteCell implements Cell {
  constructor(public i: number, public j: number) {}

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

const TILE_DEGREES = 1e-4;
