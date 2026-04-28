// Constraint solver — validates generated zones against design requirements.
// Constraints extend templates; they do not replace them.
//
// buildConstraints(partial)            → fills in default values
// validateConstraints(zone, constraints) → { valid, violations[] }
// countRoomAreas(tiles, H, W)          → number of room-like floor clusters

const FLOOR = 1;
const ROAD  = 3;
const DIRS  = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const DEFAULTS = {
  // Structural
  requiredRooms:     null,   // minimum distinct room-area count, or null to skip
  hasBossRoom:       false,  // large isolated area at the far end
  hasHiddenArea:     false,  // small pocket carved off the main path
  hasTreasureRoom:   false,  // expanded dead-end, optionally guarded
  // Enemy bounds (null = let template density decide)
  minEnemies:        null,
  maxEnemies:        null,
  // Lock counts (null = let template lockChance decide)
  requiredKeys:      null,
  requiredDoors:     null,
};

// ── Public API ────────────────────────────────────────────────────────────────

// Returns a complete constraints object. Pass a partial object or null.
export function buildConstraints(partial = {}) {
  return { ...DEFAULTS, ...(partial ?? {}) };
}

// Validate a generated zone against constraints.
// zone must contain: { id, tiles, systems, config: { width, height }, _meta }
// Returns { valid: boolean, violations: Array<{ constraint: string, message: string }> }
export function validateConstraints(zone, constraints) {
  const v   = [];
  const c   = constraints;
  const { tiles, systems, _meta = {} } = zone;
  const H   = zone.config.height;
  const W   = zone.config.width;

  // ── Enemy bounds ─────────────────────────────────────────────
  const en = systems.enemies.length;
  if (c.minEnemies !== null && en < c.minEnemies)
    v.push({ constraint: 'minEnemies',
             message: `need ≥${c.minEnemies} enemies, got ${en}` });
  if (c.maxEnemies !== null && en > c.maxEnemies)
    v.push({ constraint: 'maxEnemies',
             message: `need ≤${c.maxEnemies} enemies, got ${en}` });

  // ── Key / door counts ─────────────────────────────────────────
  if (c.requiredKeys !== null && systems.keys.length < c.requiredKeys)
    v.push({ constraint: 'requiredKeys',
             message: `need ${c.requiredKeys} keys, got ${systems.keys.length}` });
  if (c.requiredDoors !== null && systems.doors.length < c.requiredDoors)
    v.push({ constraint: 'requiredDoors',
             message: `need ${c.requiredDoors} doors, got ${systems.doors.length}` });

  // ── Room count ────────────────────────────────────────────────
  if (c.requiredRooms !== null) {
    const rooms = countRoomAreas(tiles, H, W);
    if (rooms < c.requiredRooms)
      v.push({ constraint: 'requiredRooms',
               message: `need ${c.requiredRooms} rooms, detected ${rooms}` });
  }

  // ── Special areas — checked via _meta flags set during generation ─
  if (c.hasBossRoom    && !_meta.bossRoomPlaced)
    v.push({ constraint: 'hasBossRoom',    message: 'boss room could not be carved' });
  if (c.hasHiddenArea  && !_meta.hiddenAreaPlaced)
    v.push({ constraint: 'hasHiddenArea',  message: 'hidden area could not be carved' });
  if (c.hasTreasureRoom && !_meta.treasureRoomPlaced)
    v.push({ constraint: 'hasTreasureRoom', message: 'treasure room could not be carved' });

  if (v.length) {
    console.warn(
      `[Constraints] "${zone.id}" failed (${v.length}):`,
      v.map(x => `${x.constraint}(${x.message})`).join(' | '),
    );
  }

  return { valid: v.length === 0, violations: v };
}

// Count contiguous clusters of "open" floor tiles.
// A tile is "open" when it has ≥3 passable neighbours — distinguishes rooms from corridors.
// Exported so callers can inspect room structure independently.
export function countRoomAreas(tiles, H, W) {
  const open = (r, c) => {
    const t = tiles[r]?.[c];
    if (t !== FLOOR && t !== ROAD) return false;
    let n = 0;
    for (const [dr, dc] of DIRS) {
      const u = tiles[r + dr]?.[c + dc];
      if (u === FLOOR || u === ROAD) n++;
    }
    return n >= 3;
  };

  const vis = Array.from({ length: H }, () => Array(W).fill(false));
  let count = 0;

  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (vis[r][c] || !open(r, c)) continue;
      count++;
      const q = [[r, c]];
      vis[r][c] = true;
      while (q.length) {
        const [cr, cc] = q.shift();
        for (const [dr, dc] of DIRS) {
          const nr = cr + dr, nc = cc + dc;
          if (nr < 0 || nr >= H || nc < 0 || nc >= W || vis[nr][nc] || !open(nr, nc)) continue;
          vis[nr][nc] = true;
          q.push([nr, nc]);
        }
      }
    }
  }
  return count;
}
