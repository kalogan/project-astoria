const IMPASSABLE = new Set([0, 2]); // void, wall

export class Collider {
  constructor(grid) {
    this.grid = grid;
    this.rows = grid.length;
    this.cols = grid[0].length;
    this.offsetX = (this.cols - 1) / 2;
    this.offsetZ = (this.rows - 1) / 2;
  }

  tileAt(x, z) {
    const col = Math.round(x + this.offsetX);
    const row = Math.round(z + this.offsetZ);
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return 0;
    return this.grid[row][col];
  }

  // Check all 4 corners of the player's bounding box
  passable(x, z, half = 0.25) {
    return (
      !IMPASSABLE.has(this.tileAt(x + half, z + half)) &&
      !IMPASSABLE.has(this.tileAt(x + half, z - half)) &&
      !IMPASSABLE.has(this.tileAt(x - half, z + half)) &&
      !IMPASSABLE.has(this.tileAt(x - half, z - half))
    );
  }
}
