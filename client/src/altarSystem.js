// altarSystem.js — jewel deposit altar in clan hideout.
// Interacting with the altar deposits a carried clan_jewel:
//   - removes jewel from inventory
//   - increments clan score (if in clan) OR creates clan (if not)
//   - triggers visual feedback
//
// Emits: clan_jewel_deposited, clan_score_updated (via clanManager), clan_created

const CHANNEL_TIME = 1.5;
const ALTAR_RADIUS = 2.0;

export class AltarSystem {
  constructor(clanManager, inventory) {
    this._clanMgr    = clanManager;
    this._inventory  = inventory;
    this._player     = null;
    this._hud        = null;
    this._eventBus   = null;
    this._altars     = [];
    this._channeling = null;
    this.enabled     = true;
  }

  setContext({ player, hud }) {
    this._player = player;
    this._hud    = hud;
  }

  init(zone, registry, eventBus, rng) {
    this._eventBus   = eventBus;
    this._altars     = [];
    this._channeling = null;

    this._unsub?.();
    this._unsub = eventBus.on('entity_interact', ({ payload }) => {
      if (payload.entityType === 'altar') this._onAltarInteract(payload);
    });
  }

  loadAltars(entities) {
    this._altars = entities
      .filter(e => e.type === 'altar')
      .map(e => ({
        entityId: e.id,
        x:        e.position?.x ?? 0,
        z:        e.position?.y ?? 0,
      }));
  }

  onEvent() {}

  update(delta) {
    if (!this.enabled || !this._channeling) return;

    this._channeling.timer -= delta;
    const progress = Math.max(0, 1 - this._channeling.timer / CHANNEL_TIME);
    this._hud?.showProgress(`Depositing Jewel... ${Math.floor(progress * 100)}%`, '#f1c40f');

    if (this._channeling.timer <= 0) {
      this._completeDeposit();
    }
  }

  tryInteract(playerPos) {
    if (!this.enabled) return;
    if (this._channeling) return;

    const jewel = this._inventory?.items?.find(i => i.id === 'clan_jewel');
    if (!jewel) return;

    const altar = this._altars.find(a => {
      const dx = playerPos.x - a.x, dz = playerPos.z - a.z;
      return dx * dx + dz * dz <= ALTAR_RADIUS * ALTAR_RADIUS;
    });
    if (!altar) return;

    this._channeling = { altar, timer: CHANNEL_TIME };
    this._hud?.showBanner('Depositing Clan Jewel...', '#f1c40f', 2000);
  }

  _onAltarInteract(payload) {
    const playerPos = this._player?.mesh?.position;
    if (playerPos) this.tryInteract(playerPos);
  }

  _completeDeposit() {
    const playerId   = 'local_player';
    this._channeling = null;

    const jewel = this._inventory?.items?.find(i => i.id === 'clan_jewel');
    if (jewel) {
      const idx = this._inventory.items.indexOf(jewel);
      if (idx >= 0) this._inventory.items.splice(idx, 1);
    }

    if (this._player) this._player.carryingJewel = false;

    const existingClan = this._clanMgr.getClanByPlayer(playerId);
    if (existingClan) {
      this._clanMgr.incrementScore(existingClan.id);
      this._eventBus?.emit('clan_jewel_deposited', { clanId: existingClan.id, playerId, newScore: existingClan.score });
      this._hud?.showBanner(`+1 Clan Score! (${existingClan.name}: ${existingClan.score})`, '#f1c40f', 3000);
    } else {
      const newClan = this._clanMgr.createClan(playerId);
      this._clanMgr.incrementScore(newClan.id);
      this._eventBus?.emit('clan_jewel_deposited', { clanId: newClan.id, playerId, newScore: 1 });
      this._hud?.showBanner('Clan Created! First Score +1', '#2ecc71', 3000);
    }

    console.log('[Altar] Jewel deposited');
  }

  cancelChannel() {
    if (!this._channeling) return;
    this._channeling = null;
    this._hud?.showBanner('Deposit Cancelled', '#888', 1200);
  }

  inspect() {
    console.log(`[Altar] altars=${this._altars.length}  channeling=${!!this._channeling}`);
  }
}
