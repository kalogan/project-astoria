const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];

function heuristic(ac, ar, bc, br) {
  return Math.abs(ac - bc) + Math.abs(ar - br);
}

export function findPath(grid, startCol, startRow, endCol, endRow) {
  const rows = grid.length;
  const cols = grid[0].length;

  function walkable(c, r) {
    if (c < 0 || c >= cols || r < 0 || r >= rows) return false;
    return grid[r][c] !== 0 && grid[r][c] !== 2;
  }

  if (!walkable(endCol, endRow)) return [];

  const key = (c, r) => r * cols + c;
  const open   = new Map();
  const closed = new Set();

  const startNode = { col: startCol, row: startRow, g: 0, parent: null };
  startNode.f = heuristic(startCol, startRow, endCol, endRow);
  open.set(key(startCol, startRow), startNode);

  while (open.size > 0) {
    // Pop lowest-f node
    let current;
    for (const node of open.values()) {
      if (!current || node.f < current.f) current = node;
    }

    if (current.col === endCol && current.row === endRow) {
      const path = [];
      for (let n = current; n; n = n.parent) path.unshift({ col: n.col, row: n.row });
      return path;
    }

    open.delete(key(current.col, current.row));
    closed.add(key(current.col, current.row));

    for (const [dc, dr] of DIRS) {
      const nc = current.col + dc;
      const nr = current.row + dr;
      const nk = key(nc, nr);

      if (!walkable(nc, nr) || closed.has(nk)) continue;

      const g = current.g + 1;
      const existing = open.get(nk);
      if (!existing || g < existing.g) {
        open.set(nk, {
          col: nc, row: nr,
          g, f: g + heuristic(nc, nr, endCol, endRow),
          parent: current,
        });
      }
    }
  }

  return []; // no path
}
