// hideoutSystem.js — generates and manages clan hideout zones.
// On clan creation: generates a simple hideout zone and registers it with zoneManager.
// Access control: checks player.clanId before allowing entry.
// Uses visualPassSystem + kitbashSystem for visual decoration.
// Emits: hideout_generated, hideout_entry_denied

import { KitbashSystem }    from './kitbashSystem.js';
import { VisualPassSystem } from './visualPassSystem.js';
import { StyleEnforcer }    from './styleEnforcer.js';

function _grid(W, H, fn) {
  return Array.from({ length: H }, (_, r) =>
    Array.from({ length: W }, (_, c) => fn(r, c))
  );
}

function _buildHideoutTiles(W, H) {
  return _grid(W, H, (r, c) => {
    if (r === 0 || r === H - 1 || c === 0 || c === W - 1) return 2;
    const cr = Math.floor(H / 2), cc = Math.floor(W / 2);
    if ((Math.abs(r - cr) === 3 && Math.abs(c - cc) <= 3) ||
        (Math.abs(c - cc) === 3 && Math.abs(r - cr) <= 3)) return 2;
    return 1;
  });
}

export class HideoutSystem {
  constructor(clanManager, zoneManager) {
    this._clanMgr  = clanManager;
    this._zoneMgr  = zoneManager;
    this._eventBus = null;
    this._kitbash  = new KitbashSystem();
    this._visual   = new VisualPassSystem();
    this._enforcer = new StyleEnforcer();
  }

  init(eventBus) {
    this._eventBus = eventBus;

    eventBus.on('clan_created', ({ clanId }) => {
      this.generateHideout(clanId);
    });
  }

  generateHideout(clanId) {
    const clan = this._clanMgr.getClan(clanId);
    if (!clan) return null;

    const W      = 20, H = 20;
    const zoneId = `hideout_${clanId}`;

    const zone = {
      id:          zoneId,
      config:      { width: W, height: H, seed: 0xC1A4 + clanId.length },
      playerStart: { x: 0, z: 0 },
      tiles:       _buildHideoutTiles(W, H),
      entities: [
        { id: `${zoneId}_altar`,      type: 'altar',  position: { x: 0, y: 0  } },
        { id: `${zoneId}_portal_out`, type: 'portal', position: { x: 0, y: -8 } },
      ],
      systems: {
        portals: [{
          entityId:   `${zoneId}_portal_out`,
          targetZone: 'aston_core',
          radius:     2,
          spawnX:     0,
          spawnZ:     0,
        }],
      },
      encounters:  [],
      clanId,
      isSafeZone:  true,
    };

    this._zoneMgr._generatedZones.set(zoneId, zone);
    this._clanMgr.setHideout(clanId, zoneId);

    this._eventBus?.emit('hideout_generated', { clanId, zoneId });
    console.log(`[Hideout] Generated zone "${zoneId}" for clan ${clanId}`);
    return zone;
  }

  canEnter(zoneId, player) {
    const zone = this._zoneMgr._generatedZones.get(zoneId);
    if (!zone?.clanId) return true;
    if (!player.clanId) {
      this._eventBus?.emit('hideout_entry_denied', { zoneId, reason: 'no_clan' });
      return false;
    }
    const allowed = player.clanId === zone.clanId;
    if (!allowed) this._eventBus?.emit('hideout_entry_denied', { zoneId, reason: 'wrong_clan' });
    return allowed;
  }

  async enterHideout(player, zoneManager) {
    const clan = this._clanMgr.getClanByPlayer(player.id ?? 'local_player');
    if (!clan?.hideoutZoneId) {
      console.warn('[Hideout] Player has no clan or hideout');
      return;
    }
    await zoneManager.load(clan.hideoutZoneId);
  }

  inspect() {
    console.log('[Hideout] Registered hideouts:');
    for (const [id, z] of this._zoneMgr._generatedZones) {
      if (id.startsWith('hideout_')) console.log(`  ${id} (clan: ${z.clanId})`);
    }
  }
}
