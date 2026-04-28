// overheadBarSystem.js — 3D overhead resource bars for player and enemies.
//
// Renders thin, camera-facing bar groups directly in the Three.js scene,
// attached as children of each entity's root mesh so they move with it.
//
// ── PLAYER bars (bottom → top) ────────────────────────────────────────────────
//   HP      red      always visible
//   Shield  orange   only visible when player.shield > 0
//   Mana    blue     always visible (hidden when class has no mana)
//
// ── ENEMY bars ────────────────────────────────────────────────────────────────
//   HP      red      always visible, hidden when enemy is at full HP
//
// ── BILLBOARD ─────────────────────────────────────────────────────────────────
//   Camera is orthographic at (20,20,20) looking at (0,0,0) — all entities
//   see the camera from the same direction (1,1,1)/√3 regardless of world pos.
//   One fixed quaternion is computed and applied to every bar group.
//
// ── BAR FILL TECHNIQUE ────────────────────────────────────────────────────────
//   Each bar = dark background box + coloured fill box.
//   Fill is scaled on X (scale.x = pct) and shifted left so the fill shrinks
//   from the right edge, keeping the left edge fixed.

import * as THREE from 'three';

// ── Constants ──────────────────────────────────────────────────────────────────
const BAR_W   = 0.52;    // world units
const BAR_H   = 0.048;
const BAR_D   = 0.012;
const BAR_GAP = 0.072;   // vertical spacing between stacked bars
const HEAD_Y  = 0.78;    // height above entity mesh origin (character head ≈ 0.45–0.65)

const CLR = {
  hp:     0xc0392b,
  hpLow:  0xe67e22,   // ≤ 50 %
  hpCrit: 0xe74c3c,   // ≤ 25 %
  shield: 0xe8901a,   // light orange
  mana:   0x2471a3,
  bg:     0x0d0d0d,
};

// Fixed billboard quaternion: rotates local +Z toward camera direction (1,1,1)/√3.
// Computed once — valid for all world positions with an orthographic camera.
const BILLBOARD_Q = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(1, 1, 1).normalize(),
);

// Shared geometry cache
const _bgGeo   = new THREE.BoxGeometry(BAR_W + 0.022, BAR_H + 0.014, BAR_D * 0.6);
const _fillGeo = new THREE.BoxGeometry(BAR_W, BAR_H, BAR_D);

// ─────────────────────────────────────────────────────────────────────────────
// SingleBar — one background + fill pair
// ─────────────────────────────────────────────────────────────────────────────

class SingleBar {
  constructor(color) {
    this.group = new THREE.Group();

    // Background
    const bgMat = new THREE.MeshBasicMaterial({
      color: CLR.bg, transparent: true, opacity: 0.72, depthWrite: false,
    });
    this.bg = new THREE.Mesh(_bgGeo, bgMat);
    this.group.add(this.bg);

    // Fill — rendered in front of bg via position.z offset
    this.fillMat = new THREE.MeshBasicMaterial({ color, depthWrite: false });
    this.fill    = new THREE.Mesh(_fillGeo, this.fillMat);
    this.fill.position.z = BAR_D * 0.7;
    this.group.add(this.fill);

    this._pct = 1;
  }

  /** Set fill fraction [0..1]. Returns true if value actually changed. */
  setPct(pct) {
    const p = Math.max(0.001, Math.min(1, pct));
    if (Math.abs(this._pct - p) < 0.001) return false;
    this._pct = p;
    this.fill.scale.x  = p;
    this.fill.position.x = -BAR_W * (1 - p) * 0.5;  // keep left edge fixed
    return true;
  }

  setColor(hex) {
    this.fillMat.color.setHex(hex);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EntityBars — bar stack for a single entity, attached to entity.mesh
// ─────────────────────────────────────────────────────────────────────────────

class EntityBars {
  /**
   * @param {THREE.Object3D} entityMesh  — the entity's root mesh
   * @param {'player'|'enemy'}  mode
   */
  constructor(entityMesh, mode) {
    this._root = entityMesh;
    this._mode = mode;

    this._anchor = new THREE.Group();
    this._anchor.position.y = HEAD_Y;
    this._anchor.quaternion.copy(BILLBOARD_Q);
    entityMesh.add(this._anchor);

    // Always-present bars
    this._hp = new SingleBar(CLR.hp);
    this._anchor.add(this._hp.group);

    if (mode === 'player') {
      this._shield = new SingleBar(CLR.shield);
      this._anchor.add(this._shield.group);

      this._mana = new SingleBar(CLR.mana);
      this._anchor.add(this._mana.group);
    }

    this._layoutBars();
  }

  /** Reposition bars in vertical stack based on which are visible. */
  _layoutBars() {
    // Collect active bars bottom→top: HP first, then shield (if visible), then mana
    const active = [this._hp];
    if (this._shield?.group.visible) active.push(this._shield);
    if (this._mana)                  active.push(this._mana);

    const total  = active.length;
    const bottom = -((total - 1) * BAR_GAP) / 2;
    for (let i = 0; i < total; i++) {
      active[i].group.position.y = bottom + i * BAR_GAP;
    }
  }

  updatePlayer(player, build) {
    // HP
    const hpPct = Math.max(0, player.hp / (player.maxHp || 1));
    this._hp.setPct(hpPct);
    this._hp.setColor(hpPct > 0.5 ? CLR.hp : hpPct > 0.25 ? CLR.hpLow : CLR.hpCrit);

    // Shield — only show when > 0
    const hasShield = player.shield > 0;
    if (this._shield.group.visible !== hasShield) {
      this._shield.group.visible = hasShield;
      this._layoutBars();
    }
    if (hasShield) {
      this._shield.setPct(player.shield / (player.maxShield || player.shield));
    }

    // Mana
    const pool = build?.getManaPool?.() ?? 0;
    const manaVisible = pool > 0;
    if (this._mana.group.visible !== manaVisible) {
      this._mana.group.visible = manaVisible;
      this._layoutBars();
    }
    if (manaVisible) {
      this._mana.setPct((build?.getCurrentMana?.() ?? 0) / pool);
    }
  }

  updateEnemy(enemy) {
    const pct = Math.max(0, enemy.hp / (enemy.maxHp || 1));
    // Only show bar when not at full HP
    const show = pct < 0.999;
    this._anchor.visible = show;
    if (show) {
      this._hp.setPct(pct);
      this._hp.setColor(pct > 0.5 ? CLR.hp : pct > 0.25 ? CLR.hpLow : CLR.hpCrit);
    }
  }

  /** Detach from entity and clean up. */
  dispose() {
    this._root.remove(this._anchor);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OverheadBarSystem — system class
// ─────────────────────────────────────────────────────────────────────────────

export class OverheadBarSystem {
  constructor() {
    this._registry  = null;
    this._player    = null;
    this._build     = null;
    this._playerBars = null;
    this._enemyBars  = new Map();   // enemyId → EntityBars
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  setContext({ player, build }) {
    this._player = player;
    this._build  = build;
  }

  init(_zone, registry /*, eventBus */) {
    this._registry = registry;
    this._clear();

    // Player bars — created once, persists across zones
    if (this._player && !this._playerBars) {
      this._playerBars = new EntityBars(this._player.mesh, 'player');
    }
    // Shield starts hidden
    if (this._playerBars?._shield) {
      this._playerBars._shield.group.visible = false;
      this._playerBars._layoutBars();
    }
  }

  onEvent() {}

  // ── Update ─────────────────────────────────────────────────────────────────

  update(/* delta */) {
    // Player
    if (this._playerBars && this._player) {
      this._playerBars.updatePlayer(this._player, this._build);
    }

    // Enemies — lazily create EntityBars on first update
    if (!this._registry) return;
    for (const e of this._registry.getEntitiesByType('enemy')) {
      if (!e.alive) {
        // Remove bar if enemy just died
        if (this._enemyBars.has(e.id)) {
          this._enemyBars.get(e.id).dispose();
          this._enemyBars.delete(e.id);
        }
        continue;
      }
      if (!this._enemyBars.has(e.id)) {
        this._enemyBars.set(e.id, new EntityBars(e.mesh, 'enemy'));
      }
      this._enemyBars.get(e.id).updateEnemy(e);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _clear() {
    for (const [, bars] of this._enemyBars) bars.dispose();
    this._enemyBars.clear();
    // Player bars persist — reset shield visibility
    if (this._playerBars?._shield) {
      this._playerBars._shield.group.visible = false;
      this._playerBars._layoutBars();
    }
  }

  // ── Debug ──────────────────────────────────────────────────────────────────

  inspect() {
    console.log(`[OverheadBars] player=${!!this._playerBars}  enemies=${this._enemyBars.size}`);
  }
}
