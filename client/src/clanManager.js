// clanManager.js — clan state management.
// Stores: id, name, members[], score, hideoutZoneId
// Persists to 'astoria_clans' in localStorage.
// Emits clan_created, clan_score_updated via injected eventBus.

const STORAGE_KEY = 'astoria_clans';

export class ClanManager {
  constructor() {
    this._clans    = new Map();   // clanId → ClanDef
    this._players  = new Map();   // playerId → { clanId, carryingJewel }
    this._eventBus = null;
    this._seq      = 0;
  }

  init(eventBus) {
    this._eventBus = eventBus;
    this.load();
  }

  // ── Clan CRUD ──────────────────────────────────────────────────────────────

  createClan(playerId, name) {
    const clanId  = `clan_${++this._seq}_${(Date.now() & 0xFFFF).toString(16)}`;
    const clan    = { id: clanId, name: name ?? `Clan ${this._seq}`, members: [playerId], score: 0, hideoutZoneId: null };
    this._clans.set(clanId, clan);

    // Assign player
    this._setPlayerClan(playerId, clanId);

    this._save();
    this._eventBus?.emit('clan_created', { clanId, name: clan.name, playerId });
    console.log(`[Clan] Created "${clan.name}" (${clanId}) for player ${playerId}`);
    return clan;
  }

  getClan(clanId)       { return this._clans.get(clanId) ?? null; }
  getClanByPlayer(pid)  { const p = this._players.get(pid); return p ? this._clans.get(p.clanId) : null; }
  getPlayerState(pid)   { return this._players.get(pid) ?? { clanId: null, carryingJewel: false }; }

  addMember(clanId, playerId) {
    const clan = this._clans.get(clanId);
    if (!clan) return;
    if (!clan.members.includes(playerId)) clan.members.push(playerId);
    this._setPlayerClan(playerId, clanId);
    this._save();
  }

  incrementScore(clanId, amount = 1) {
    const clan = this._clans.get(clanId);
    if (!clan) return;
    clan.score += amount;
    this._save();
    this._eventBus?.emit('clan_score_updated', { clanId, score: clan.score, delta: amount });
    console.log(`[Clan] ${clan.name} score: ${clan.score}`);
  }

  setHideout(clanId, zoneId) {
    const clan = this._clans.get(clanId);
    if (clan) { clan.hideoutZoneId = zoneId; this._save(); }
  }

  // ── Jewel state ────────────────────────────────────────────────────────────

  setCarryingJewel(playerId, carrying) {
    const state = this._getOrCreatePlayerState(playerId);
    state.carryingJewel = carrying;
  }

  isCarryingJewel(playerId) {
    return this._players.get(playerId)?.carryingJewel ?? false;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  save()  { this._save(); }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const { clans, players, seq } = JSON.parse(raw);
      this._seq     = seq ?? 0;
      this._clans   = new Map((clans  ?? []).map(c => [c.id, c]));
      this._players = new Map((players ?? []).map(p => [p.id, p]));
    } catch { /* ignore */ }
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        seq:     this._seq,
        clans:   [...this._clans.values()],
        players: [...this._players.entries()].map(([id, s]) => ({ id, ...s })),
      }));
    } catch { /* ignore */ }
  }

  _setPlayerClan(playerId, clanId) {
    const s = this._getOrCreatePlayerState(playerId);
    s.clanId = clanId;
  }

  _getOrCreatePlayerState(playerId) {
    if (!this._players.has(playerId)) this._players.set(playerId, { clanId: null, carryingJewel: false });
    return this._players.get(playerId);
  }

  // ── Debug ──────────────────────────────────────────────────────────────────

  inspect() {
    console.group('[Clan Manager]');
    for (const c of this._clans.values())
      console.log(`${c.name} (${c.id}): score=${c.score} members=${c.members.length} hideout=${c.hideoutZoneId ?? 'none'}`);
    console.groupEnd();
  }

  reset() {
    this._clans.clear();
    this._players.clear();
    this._seq = 0;
    this._save();
    console.log('[Clan] Reset');
  }
}
