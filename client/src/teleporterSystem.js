// teleporterSystem.js — fast travel between registered destinations.
//
// Flow: player interacts with teleporter entity
//       → teleporter_open event
//       → _showDestinationUI() (minimal console or HUD list)
//       → player selects (teleport_requested event)
//       → validate → zoneManager.load()
//       → player_teleported event emitted

import { TELEPORT_DESTINATIONS, getDestination, getUnlocked } from './teleportRegistry.js';

export class TeleporterSystem {
  constructor(zoneManager) {
    this._zoneMgr  = zoneManager;
    this._player   = null;
    this._eventBus = null;
    this._hud      = null;
    this._open     = false;
    this._overlay  = null;
    this.enabled   = true;
  }

  setContext({ player, hud }) {
    this._player = player;
    this._hud    = hud;
  }

  init(zone, registry, eventBus) {
    this._eventBus = eventBus;

    this._unsub?.();
    const u1 = eventBus.on('teleporter_open',    ()            => this._showUI());
    const u2 = eventBus.on('teleport_requested', ({ payload }) => this._execute(payload.destinationId));
    const u3 = eventBus.on('entity_interact',    ({ payload }) => {
      if (payload.entityType === 'teleporter') this._showUI();
    });
    this._unsub = () => { u1(); u2(); u3(); };
  }

  onEvent() {}
  update()  {}

  _showUI() {
    if (!this.enabled) return;
    this._open = true;

    // Remove old overlay
    this._overlay?.remove();

    const dests = getUnlocked();
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position:    'fixed',
      top:         '50%',
      left:        '50%',
      transform:   'translate(-50%,-50%)',
      background:  'rgba(0,0,0,0.88)',
      color:       '#ccc',
      padding:     '20px 28px',
      borderRadius:'8px',
      fontFamily:  'monospace',
      fontSize:    '13px',
      zIndex:      '500',
      minWidth:    '260px',
      border:      '1px solid #446',
    });

    const title = document.createElement('div');
    title.style.cssText = 'color:#f39c12;font-size:15px;margin-bottom:14px;letter-spacing:1px;';
    title.textContent = '── TELEPORTER ──';
    overlay.appendChild(title);

    for (const dest of dests) {
      const btn = document.createElement('div');
      btn.style.cssText = 'padding:5px 0;cursor:pointer;';
      btn.textContent = `[${dest.id.toUpperCase()}] ${dest.name}`;
      btn.onmouseenter = () => btn.style.color = '#f39c12';
      btn.onmouseleave = () => btn.style.color = '';
      btn.onclick      = () => {
        this._closeUI();
        this._execute(dest.id);
      };
      overlay.appendChild(btn);
    }

    const close = document.createElement('div');
    close.style.cssText = 'margin-top:12px;color:#666;cursor:pointer;';
    close.textContent = '[ESC] Close';
    close.onclick = () => this._closeUI();
    overlay.appendChild(close);

    document.body.appendChild(overlay);
    this._overlay = overlay;

    // ESC to close
    const onKey = (e) => {
      if (e.key === 'Escape') { window.removeEventListener('keydown', onKey); this._closeUI(); }
    };
    window.addEventListener('keydown', onKey);

    console.log('[Teleporter] UI opened');
  }

  _closeUI() {
    this._open = false;
    this._overlay?.remove();
    this._overlay = null;
  }

  _execute(destId) {
    if (!destId) return;
    const dest = getDestination(destId);
    if (!dest) { console.warn(`[Teleporter] Unknown destination: ${destId}`); return; }
    if (!dest.unlocked) { this._hud?.showBanner('Destination Locked', '#e74c3c', 1500); return; }

    console.log(`[Teleporter] Teleporting to "${dest.name}" (${dest.zoneId})`);

    // Screen fade + load
    this._hud?.screenFlash?.('#000', 0.7);
    setTimeout(async () => {
      await this._zoneMgr.load(dest.zoneId, { x: dest.spawnX, z: dest.spawnZ });
      this._eventBus?.emit('player_teleported', { destinationId: destId, zoneId: dest.zoneId });
      this._hud?.showBanner(`Arrived: ${dest.name}`, '#3498db', 1800);
    }, 300);
  }

  unlock(destId) {
    const d = getDestination(destId);
    if (d) { d.unlocked = true; console.log(`[Teleporter] Unlocked: ${destId}`); }
  }

  isOpen()  { return this._open; }

  inspect() {
    console.log('[Teleporter] destinations:', getUnlocked().map(d => d.id).join(', '));
  }

  teleportTo(destId) { this._execute(destId); }
}
