/**
 * Procedural zone generator — produces objects matching the static zone schema.
 *
 * generateZone(config, template?, constraints?) → zone object
 *
 * config:      { id, width, height, seed, name?, targetZone?, returnSpawnX?, returnSpawnZ? }
 * template:    TEMPLATES entry from zoneTemplates.js, or a name string. Default: dungeon.
 * constraints: partial constraints object from constraintSolver.js. Default: none.
 *
 * Determinism guarantee:
 *   same seed + same template + same constraints → identical output
 *   retry attempts use seed derived from original: seed ^ (attempt × PERTURB)
 *
 * Via ZoneManager:
 *   import { TEMPLATES } from './zoneTemplates.js';
 *   await zone.loadGeneratedZone(
 *     { id:'g1', width:40, height:40, seed:99 },
 *     TEMPLATES.dungeon,
 *     { minEnemies:5, hasBossRoom:true }
 *   );
 */

import { createRNG } from './rng.js';
import { DEFAULT_TEMPLATE, getTemplate } from './zoneTemplates.js';
import { buildConstraints, validateConstraints } from './constraintSolver.js';

const WALL  = 2;
const FLOOR = 1;
const ROAD  = 3;

const MAX_ATTEMPTS  = 5;
const SEED_PERTURB  = 0x9E3779B9; // golden-ratio constant for seed derivation

const KEY_PAIRS = [
  { keyId: 'gold',    keyColor: '#ffd700', doorColor: '#b8860b' },
  { keyId: 'silver',  keyColor: '#c0c0c0', doorColor: '#708090' },
  { keyId: 'emerald', keyColor: '#00e676', doorColor: '#006400' },
  { keyId: 'ruby',    keyColor: '#ff1744', doorColor: '#7f0000' },
];

const TYPE_NAMES = {
  hub:     'Ancient Ruins',
  forest:  'Mystical Forest',
  dungeon: 'Dungeon Depths',
};

// ── Public API ────────────────────────────────────────────────────────────────

export function generateZone(config, template = DEFAULT_TEMPLATE, constraints = null) {
  if (typeof template === 'string') template = getTemplate(template) ?? DEFAULT_TEMPLATE;
  const C = buildConstraints(constraints);

  console.log(`[Gen] "${config.id}" type=${template.type} layout=${template.layout} seed=${config.seed}`);

  let lastResult = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Attempt 1 uses the original seed; subsequent attempts use a deterministic derivation.
    const seed = attempt === 1
      ? config.seed
      : ((config.seed ^ (attempt * SEED_PERTURB)) >>> 0);

    const rng    = createRNG(seed);
    const result = _attempt(config, template, rng, C);
    lastResult   = result;

    const { valid, violations } = validateConstraints(result, C);
    if (valid) {
      if (attempt > 1) console.log(`[Gen] "${config.id}" passed constraints on attempt ${attempt}`);
      const { _meta, ...zone } = result;
      return zone;
    }

    if (attempt < MAX_ATTEMPTS) {
      console.warn(`[Gen] "${config.id}" attempt ${attempt}/${MAX_ATTEMPTS} — retrying`);
    } else {
      console.warn(`[Gen] "${config.id}" all ${MAX_ATTEMPTS} attempts failed — returning best effort`);
    }
  }

  const { _meta, ...zone } = lastResult;
  return zone;
}

// ── Single generation attempt ─────────────────────────────────────────────────
// All randomness flows through the provided `rng` — no direct Math.random() calls.

function _attempt(config, template, rng, constraints) {
  const { id, width: W, height: H } = config;

  // ── 1. Layout ───────────────────────────────────────────────
  const layout =
    template.layout === 'field' ? _layoutField(W, H, rng, template.rules) :
    template.layout === 'spine' ? _layoutSpine(W, H, rng, template.rules) :
                                  _layoutMaze(W, H, rng, template.rules);

  const { tiles, spawnRow, spawnCol, exitRow, exitCol } = layout;
  _ensurePath(tiles, H, W, spawnRow, spawnCol, exitRow, exitCol);

  // ── 2. Special rooms (carve into tiles before entity placement) ──
  const _meta = _applySpecialRooms(tiles, H, W, rng, spawnRow, spawnCol, constraints);

  // Re-check path after carving (hidden areas pierce walls)
  _ensurePath(tiles, H, W, spawnRow, spawnCol, exitRow, exitCol);

  // ── 3. Coordinate helpers ───────────────────────────────────
  const offsetX    = (W - 1) / 2;
  const offsetZ    = (H - 1) / 2;
  const toWorld    = (row, col) => ({ x: col - offsetX, z: row - offsetZ });
  const spawnWorld = toWorld(spawnRow, spawnCol);
  const exitWorld  = toWorld(exitRow, exitCol);

  // Collect all passable tiles and shuffle with seeded RNG
  const floors = _floorTiles(tiles, H, W);
  _shuffle(floors, rng);

  const entities = [];
  const systems  = { keys: [], doors: [], enemies: [], portals: [], quests: [] };

  // ── 4. Portal ───────────────────────────────────────────────
  if (template.entities.hasPortals && config.targetZone) {
    const pid = `${id}_portal`;
    entities.push({ id: pid, type: 'portal', position: { x: exitWorld.x, y: exitWorld.z } });
    systems.portals.push({
      entityId:   pid,
      radius:     1.2,
      targetZone: config.targetZone,
      spawnX:     config.returnSpawnX ?? 0,
      spawnZ:     config.returnSpawnZ ?? 0,
    });
  }

  // ── 5. Enemies ──────────────────────────────────────────────
  // Count: template density × floor area, then clamped by constraints.
  const templateCount = Math.round(floors.length * template.rules.enemyDensity);
  let enemyCount = Math.max(2, Math.min(templateCount, 12));
  if (constraints.minEnemies !== null) enemyCount = Math.max(enemyCount, constraints.minEnemies);
  if (constraints.maxEnemies !== null) enemyCount = Math.min(enemyCount, constraints.maxEnemies);
  enemyCount = Math.min(enemyCount, floors.length);

  // Special positions (boss guards, treasure guards) get priority slots.
  const specialPos = _buildSpecialPositions(_meta, tiles, H);
  _placeEnemies(specialPos, floors, toWorld, spawnRow, spawnCol, exitRow, exitCol,
                spawnWorld, enemyCount, id, entities, systems);

  // ── 6. Key / Door pairs ─────────────────────────────────────
  // Hard constraint overrides template lockChance.
  let pairCount = 0;
  if (constraints.requiredKeys !== null || constraints.requiredDoors !== null) {
    pairCount = Math.max(constraints.requiredKeys ?? 0, constraints.requiredDoors ?? 0);
  } else if (template.entities.hasDoors && template.entities.hasKeys) {
    pairCount = rng.next() < (template.entities.lockChance ?? 0) ? 1 : 0;
  }
  pairCount = Math.min(pairCount, KEY_PAIRS.length);

  if (pairCount > 0) {
    const shuffledPairs = [...KEY_PAIRS];
    _shuffle(shuffledPairs, rng);
    for (let i = 0; i < pairCount; i++) {
      _placeLockPair(floors, toWorld, spawnRow, spawnCol, exitRow, exitCol,
                     spawnWorld, shuffledPairs[i], id, i, entities, systems);
    }
  }

  // ── 7. Quest ────────────────────────────────────────────────
  if (systems.enemies.length > 0) {
    systems.quests.push({
      id:    `${id}_hunt`,
      type:  'kill',
      title: `Clear the ${TYPE_NAMES[template.type] ?? 'Zone'}`,
      goal:  Math.ceil(systems.enemies.length / 2),
    });
  }

  return {
    id,
    name:   config.name ?? (TYPE_NAMES[template.type] ?? 'Unknown Zone'),
    config: { width: W, height: H, tileSize: 1, seed: config.seed },
    playerStart: spawnWorld,
    tiles,
    entities,
    systems,
    _meta,
  };
}

// ── Special room carving ──────────────────────────────────────────────────────

function _applySpecialRooms(tiles, H, W, rng, spawnRow, spawnCol, constraints) {
  const meta = {
    bossRoomPlaced:     false, bossRoomCenter:    null,
    hiddenAreaPlaced:   false,
    treasureRoomPlaced: false, treasureRoomCenter: null,
  };

  if (constraints.hasBossRoom) {
    const pos = _carveBossRoom(tiles, H, W, spawnRow, spawnCol);
    if (pos) { meta.bossRoomPlaced = true; meta.bossRoomCenter = pos; }
  }

  if (constraints.hasHiddenArea) {
    const pos = _carveHiddenArea(tiles, H, W, rng);
    if (pos) meta.hiddenAreaPlaced = true;
  }

  if (constraints.hasTreasureRoom) {
    const pos = _carveTreasureRoom(tiles, H, W, rng, spawnRow, spawnCol);
    if (pos) { meta.treasureRoomPlaced = true; meta.treasureRoomCenter = pos; }
  }

  return meta;
}

// Boss room: BFS-farthest reachable tile from spawn → expand into a large room.
function _carveBossRoom(tiles, H, W, spawnRow, spawnCol) {
  const dist = _bfsDist(tiles, H, W, spawnRow, spawnCol);

  let maxD = 0, farR = spawnRow, farC = spawnCol;
  for (let r = 1; r < H - 1; r++) {
    for (let c = 1; c < W - 1; c++) {
      if (dist[r][c] > maxD) { maxD = dist[r][c]; farR = r; farC = c; }
    }
  }

  if (maxD === 0) return null; // no reachable tiles besides spawn

  const rh = Math.min(2, Math.floor(H / 10));
  const rw = Math.min(3, Math.floor(W / 10));
  for (let dr = -rh; dr <= rh; dr++) {
    for (let dc = -rw; dc <= rw; dc++) {
      const nr = farR + dr, nc = farC + dc;
      if (nr > 0 && nr < H - 1 && nc > 0 && nc < W - 1) tiles[nr][nc] = FLOOR;
    }
  }
  return { row: farR, col: farC };
}

// Hidden area: break through a wall adjacent to floor into a carved 3×3 pocket.
function _carveHiddenArea(tiles, H, W, rng) {
  const candidates = [];
  for (let r = 2; r < H - 2; r++) {
    for (let c = 2; c < W - 2; c++) {
      if (tiles[r][c] !== FLOOR && tiles[r][c] !== ROAD) continue;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const wr = r + dr,     wc = c + dc;     // wall to break
        const pr = r + dr * 2, pc = c + dc * 2; // pocket center
        if (wr < 1 || wr >= H - 1 || wc < 1 || wc >= W - 1) continue;
        if (pr < 1 || pr >= H - 1 || pc < 1 || pc >= W - 1) continue;
        if (tiles[wr][wc] === WALL && tiles[pr][pc] === WALL)
          candidates.push([wr, wc, pr, pc]);
      }
    }
  }
  if (!candidates.length) return null;

  const [wr, wc, pr, pc] = candidates[rng.nextInt(0, candidates.length - 1)];
  tiles[wr][wc] = FLOOR;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const nr = pr + dr, nc = pc + dc;
      if (nr > 0 && nr < H - 1 && nc > 0 && nc < W - 1) tiles[nr][nc] = FLOOR;
    }
  }
  return { row: pr, col: pc };
}

// Treasure room: find a dead-end ≥5 tiles from spawn and expand it.
function _carveTreasureRoom(tiles, H, W, rng, spawnRow, spawnCol) {
  const deadEnds = [];
  for (let r = 1; r < H - 1; r++) {
    for (let c = 1; c < W - 1; c++) {
      if (tiles[r][c] !== FLOOR) continue;
      const dr = r - spawnRow, dc = c - spawnCol;
      if (dr * dr + dc * dc < 25) continue; // must be ≥5 tiles from spawn
      let open = 0;
      for (const [ddr, ddc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const t = tiles[r + ddr]?.[c + ddc];
        if (t === FLOOR || t === ROAD) open++;
      }
      if (open === 1) deadEnds.push([r, c]);
    }
  }
  if (!deadEnds.length) return null;

  const [tr, tc] = deadEnds[rng.nextInt(0, deadEnds.length - 1)];
  const rh = rng.next() < 0.5 ? 1 : 2;
  const rw = rh === 1         ? 2 : 1;
  for (let dr = -rh; dr <= rh; dr++) {
    for (let dc = -rw; dc <= rw; dc++) {
      const nr = tr + dr, nc = tc + dc;
      if (nr > 0 && nr < H - 1 && nc > 0 && nc < W - 1) tiles[nr][nc] = FLOOR;
    }
  }
  return { row: tr, col: tc };
}

// Build an ordered list of priority enemy positions from special-room centers.
// Boss room gets 2 guards; treasure room gets 1.
function _buildSpecialPositions(meta, tiles, H) {
  const positions = [];
  const add = (r, c) => {
    const t = tiles[r]?.[c];
    if (t === FLOOR || t === ROAD) positions.push([r, c]);
  };

  if (meta.bossRoomCenter) {
    const { row, col } = meta.bossRoomCenter;
    add(Math.max(1, row - 1), col);
    add(Math.min(H - 2, row + 1), col);
  }
  if (meta.treasureRoomCenter) {
    const { row, col } = meta.treasureRoomCenter;
    add(row, col);
  }
  return positions;
}

// ── Layout generators ─────────────────────────────────────────────────────────

function _layoutMaze(W, H, rng, rules) {
  const tiles = Array.from({ length: H }, () => Array(W).fill(WALL));
  const mH    = Math.floor((H - 1) / 2);
  const mW    = Math.floor((W - 1) / 2);
  const vis   = Array.from({ length: mH }, () => Array(mW).fill(false));
  const pos   = (mr, mc) => [mr * 2 + 1, mc * 2 + 1];
  const DIRS  = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  const [sr, sc] = pos(0, 0);
  tiles[sr][sc]  = FLOOR;
  vis[0][0]      = true;
  const stack    = [[0, 0]];

  while (stack.length) {
    const [mr, mc]  = stack[stack.length - 1];
    const [tr, tc]  = pos(mr, mc);
    const neighbors = [];
    for (const [dr, dc] of DIRS) {
      const nr = mr + dr, nc = mc + dc;
      if (nr >= 0 && nr < mH && nc >= 0 && nc < mW && !vis[nr][nc])
        neighbors.push([dr, dc, nr, nc]);
    }
    if (!neighbors.length) { stack.pop(); continue; }
    const [dr, dc, nr, nc] = neighbors[rng.nextInt(0, neighbors.length - 1)];
    vis[nr][nc]             = true;
    tiles[tr + dr][tc + dc] = FLOOR;
    const [ntr, ntc]        = pos(nr, nc);
    tiles[ntr][ntc]         = FLOOR;
    stack.push([nr, nc]);
  }

  const loopFactor = rules.loops ? (rules.loopFactor ?? 0.15) : 0;
  const loopBudget = Math.floor(mH * mW * loopFactor);
  for (let i = 0; i < loopBudget; i++) {
    const r = rng.nextInt(1, H - 2);
    const c = rng.nextInt(1, W - 2);
    if (tiles[r][c] !== WALL) continue;
    const horiz = tiles[r][c - 1] === FLOOR && tiles[r][c + 1] === FLOOR;
    const vert  = tiles[r - 1][c] === FLOOR && tiles[r + 1][c] === FLOOR;
    if (horiz || vert) tiles[r][c] = FLOOR;
  }

  const [exitR, exitC] = pos(mH - 1, mW - 1);
  return { tiles, spawnRow: sr, spawnCol: sc, exitRow: exitR, exitCol: exitC };
}

function _layoutField(W, H, rng, rules) {
  const tiles = Array.from({ length: H }, () => Array(W).fill(FLOOR));
  for (let c = 0; c < W; c++) { tiles[0][c] = WALL; tiles[H - 1][c] = WALL; }
  for (let r = 0; r < H; r++) { tiles[r][0] = WALL; tiles[r][W - 1] = WALL; }

  const density  = rules.obstacleDensity ?? 0.05;
  const avgBlob  = 12;
  const target   = Math.round(W * H * density / avgBlob);
  const blobs    = rng.nextInt(Math.max(2, target - 2), Math.max(4, target + 3));
  for (let i = 0; i < blobs; i++) {
    const cr = rng.nextInt(3, H - 4);
    const cc = rng.nextInt(3, W - 4);
    const rh = rng.nextInt(1, 3);
    const rw = rng.nextInt(1, 4);
    for (let dr = -rh; dr <= rh; dr++) {
      for (let dc = -rw; dc <= rw; dc++) {
        const nr = cr + dr, nc = cc + dc;
        if (nr > 1 && nr < H - 2 && nc > 1 && nc < W - 2) tiles[nr][nc] = WALL;
      }
    }
  }

  const midR = Math.floor(H / 2), midC = Math.floor(W / 2);
  for (let c = 1; c < W - 1; c++) tiles[midR][c] = ROAD;
  for (let r = 1; r < H - 1; r++) tiles[r][midC] = ROAD;

  const spawnRow = 2, spawnCol = 2;
  const exitRow  = H - 3, exitCol = W - 3;
  tiles[spawnRow][spawnCol] = FLOOR;
  tiles[exitRow][exitCol]   = FLOOR;
  return { tiles, spawnRow, spawnCol, exitRow, exitCol };
}

function _layoutSpine(W, H, rng, rules) {
  const tiles = Array.from({ length: H }, () => Array(W).fill(WALL));
  const midC  = Math.floor(W / 2);
  const midR  = Math.floor(H / 2);

  for (let r = 1; r < H - 1; r++) {
    tiles[r][midC - 1] = FLOOR;
    tiles[r][midC]     = ROAD;
    tiles[r][midC + 1] = FLOOR;
  }

  const hub = Math.min(3, Math.floor(Math.min(W, H) / 8));
  for (let dr = -hub; dr <= hub; dr++) {
    for (let dc = -hub; dc <= hub; dc++) {
      const r = midR + dr, c = midC + dc;
      if (r > 0 && r < H - 1 && c > 0 && c < W - 1) tiles[r][c] = FLOOR;
    }
  }

  const maxBranches = 2 + Math.round((rules.branchingFactor ?? 0.5) * 3);
  const usedRows    = new Set([midR]);
  let placed = 0, attempts = 0;

  while (placed < maxBranches && attempts < 40) {
    attempts++;
    const br = rng.nextInt(3, H - 4);
    if ([...usedRows].some(u => Math.abs(br - u) <= hub + 2)) continue;
    usedRows.add(br);

    const goRight = rng.next() < 0.5;
    const maxLen  = Math.max(4, Math.floor(W / 2) - 2);
    const len     = rng.nextInt(4, maxLen);
    const sign    = goRight ? 1 : -1;

    for (let i = 0; i <= len; i++) {
      const bc = midC + sign * i;
      if (bc > 0 && bc < W - 1) tiles[br][bc] = FLOOR;
    }

    const endC = midC + sign * len;
    const rh   = rng.nextInt(1, 3), rw = rng.nextInt(1, 3);
    for (let dr = -rh; dr <= rh; dr++) {
      for (let dc = -rw; dc <= rw; dc++) {
        const nr = br + dr, nc = endC + dc;
        if (nr > 0 && nr < H - 1 && nc > 0 && nc < W - 1) tiles[nr][nc] = FLOOR;
      }
    }
    placed++;
  }

  const spawnRow = 2, spawnCol = midC;
  const exitRow  = H - 3, exitCol = midC;
  tiles[spawnRow][spawnCol] = FLOOR;
  tiles[exitRow][exitCol]   = FLOOR;
  return { tiles, spawnRow, spawnCol, exitRow, exitCol };
}

// ── Entity placement ──────────────────────────────────────────────────────────

// Special positions are tried first (no min-distance check).
// Remaining slots filled from shuffled floors with standard distance guard.
function _placeEnemies(specialPos, floors, toWorld, spawnRow, spawnCol, exitRow, exitCol,
                       spawnWorld, count, id, entities, systems) {
  const MIN_SQ = 16;
  let n = 0;

  // Priority: special room guards
  for (const [row, col] of specialPos) {
    if (n >= count) break;
    if (row === spawnRow && col === spawnCol) continue;
    if (row === exitRow  && col === exitCol)  continue;
    const w = toWorld(row, col);
    _addEnemy(w, id, n++, entities, systems);
  }

  // Fill remaining with shuffled floor tiles
  for (const [row, col] of floors) {
    if (n >= count) break;
    if (row === spawnRow && col === spawnCol) continue;
    if (row === exitRow  && col === exitCol)  continue;
    const w  = toWorld(row, col);
    const dx = w.x - spawnWorld.x, dz = w.z - spawnWorld.z;
    if (dx * dx + dz * dz < MIN_SQ) continue;
    _addEnemy(w, id, n++, entities, systems);
  }
}

function _addEnemy(w, id, n, entities, systems) {
  const eid = `${id}_e${n}`;
  entities.push({ id: eid, type: 'enemy', position: { x: w.x, y: w.z } });
  systems.enemies.push({ entityId: eid });
}

// suffix distinguishes multiple pairs (0 = first pair, 1 = second, …)
function _placeLockPair(floors, toWorld, spawnRow, spawnCol, exitRow, exitCol,
                        spawnWorld, pair, id, suffix, entities, systems) {
  const KEY_MIN_SQ = 36;
  let keyWorld = null, doorWorld = null;

  for (const [row, col] of floors) {
    if (row === spawnRow && col === spawnCol) continue;
    if (row === exitRow  && col === exitCol)  continue;
    const w  = toWorld(row, col);
    const dx = w.x - spawnWorld.x, dz = w.z - spawnWorld.z;
    if (!keyWorld  && dx * dx + dz * dz >= KEY_MIN_SQ) { keyWorld  = w; continue; }
    if (!doorWorld && keyWorld)                         { doorWorld = w; break; }
  }
  if (!keyWorld || !doorWorld) return;

  entities.push({ id: `${id}_key_${suffix}`,  type: 'key',  position: { x: keyWorld.x,  y: keyWorld.z  } });
  systems.keys.push({ entityId: `${id}_key_${suffix}`,  keyId: pair.keyId, color: pair.keyColor });

  entities.push({ id: `${id}_door_${suffix}`, type: 'door', position: { x: doorWorld.x, y: doorWorld.z } });
  systems.doors.push({ entityId: `${id}_door_${suffix}`, keyId: pair.keyId, color: pair.doorColor });
}

// ── Utility ───────────────────────────────────────────────────────────────────

function _ensurePath(tiles, H, W, sr, sc, er, ec) {
  const vis = Array.from({ length: H }, () => Array(W).fill(false));
  const q   = [[sr, sc]];
  vis[sr][sc] = true;
  while (q.length) {
    const [r, c] = q.shift();
    if (r === er && c === ec) return;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= H || nc < 0 || nc >= W || vis[nr][nc]) continue;
      if (tiles[nr][nc] !== FLOOR && tiles[nr][nc] !== ROAD)      continue;
      vis[nr][nc] = true;
      q.push([nr, nc]);
    }
  }
  let r = sr, c = sc;
  while (c !== ec) { if (tiles[r][c] === WALL) tiles[r][c] = FLOOR; c += c < ec ? 1 : -1; }
  while (r !== er) { if (tiles[r][c] === WALL) tiles[r][c] = FLOOR; r += r < er ? 1 : -1; }
}

function _bfsDist(tiles, H, W, sr, sc) {
  const dist = Array.from({ length: H }, () => Array(W).fill(-1));
  dist[sr][sc] = 0;
  const q = [[sr, sc]];
  while (q.length) {
    const [r, c] = q.shift();
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= H || nc < 0 || nc >= W || dist[nr][nc] !== -1) continue;
      const t = tiles[nr][nc];
      if (t !== FLOOR && t !== ROAD) continue;
      dist[nr][nc] = dist[r][c] + 1;
      q.push([nr, nc]);
    }
  }
  return dist;
}

function _floorTiles(tiles, H, W) {
  const out = [];
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++)
      if (tiles[r][c] === FLOOR || tiles[r][c] === ROAD) out.push([r, c]);
  return out;
}

function _shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
