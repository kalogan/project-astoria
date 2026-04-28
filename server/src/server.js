import http from 'http';
import { URL } from 'url';

// ── Environment ───────────────────────────────────────────────────────────────

const PORT         = process.env.PORT         || 3001;
const DATABASE_URL = process.env.DATABASE_URL || null;
const JWT_SECRET   = process.env.JWT_SECRET   || null;

if (!JWT_SECRET)   console.warn('[Server] JWT_SECRET not set — auth disabled');
if (!DATABASE_URL) console.warn('[Server] DATABASE_URL not set — using in-memory store');

// ── In-memory content store (replace with DB reads when DATABASE_URL is set) ──

const ZONES_CONTENT = [
  { id: 'Cameron_Start', name: 'Cameron Start', theme: 'hub',     difficulty: 1 },
  { id: 'Forest_01',     name: 'Ashwood Grove', theme: 'forest',  difficulty: 2 },
  { id: 'Dungeon_01',    name: 'Crypt Below',   theme: 'dungeon', difficulty: 3 },
];

const WORLD_CONTENT = {
  name:        'Project Astoria',
  version:     '0.1.0',
  startZone:   'Cameron_Start',
  maxTier:     99,
};

const MODIFIERS_CONTENT = [
  { id: 'enraged',      label: 'Enraged',      type: 'enemy',  tier: 1, description: '+30% enemy damage' },
  { id: 'swarm',        label: 'Swarm',         type: 'enemy',  tier: 1, description: '+25% enemy speed' },
  { id: 'tanky',        label: 'Tanky',         type: 'enemy',  tier: 1, description: '+60% enemy HP' },
  { id: 'glass_cannon', label: 'Glass Cannon',  type: 'player', tier: 2, description: '+40% player damage, -30% HP' },
  { id: 'riches',       label: 'Riches',        type: 'world',  tier: 2, description: '+60% XP and loot' },
  { id: 'darkness',     label: 'Darkness',      type: 'world',  tier: 3, description: 'Expanded enemy aggro radius' },
  { id: 'chaos',        label: 'Chaos',         type: 'world',  tier: 3, description: 'Random events every 30s' },
];

// ── Router ────────────────────────────────────────────────────────────────────

const ROUTES = {
  'GET /health':           () => ({ status: 'ok', uptime: process.uptime() }),
  'GET /content/zones':    () => ZONES_CONTENT,
  'GET /content/world':    () => WORLD_CONTENT,
  'GET /content/modifiers':() => MODIFIERS_CONTENT,
};

function route(method, pathname) {
  const key    = `${method} ${pathname}`;
  const handler = ROUTES[key];
  if (handler) return { status: 200, body: handler() };
  return { status: 404, body: { error: 'Not found', path: pathname } };
}

// ── CORS headers ──────────────────────────────────────────────────────────────

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url      = new URL(req.url, `http://localhost:${PORT}`);
  const { status, body } = route(req.method, url.pathname);

  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
});

server.listen(PORT, () => {
  console.log(`[Server] listening on port ${PORT}`);
  console.log(`[Server] routes: ${Object.keys(ROUTES).join(', ')}`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`[Server] ${signal} received — shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
