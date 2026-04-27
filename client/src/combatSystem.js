import * as THREE from 'three';

const ATTACK_RANGE    = 2.5;
const ATTACK_DAMAGE   = 34;
const ATTACK_COOLDOWN = 0.4;
const FLASH_DURATION  = 0.08;
const LOOT_PICKUP_SQ  = 1.0; // squared distance

class Loot {
  constructor(scene, x, z) {
    const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffd700 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x, 0.4, z);
    this.collected = false;
    scene.add(this.mesh);
  }

  collect() {
    this.collected = true;
    this.mesh.visible = false;
  }
}

export class CombatSystem {
  constructor(scene, enemySystem, player) {
    this.scene       = scene;
    this.enemies     = enemySystem.enemies;
    this.player      = player;
    this.cooldown    = 0;
    this.loot        = [];
    this.flashing    = [];
    this.attackReady = false;

    window.addEventListener('click', () => { this.attackReady = true; });
  }

  update(delta) {
    this.cooldown = Math.max(0, this.cooldown - delta);

    if (this.attackReady) {
      this.attackReady = false;
      if (this.cooldown === 0) {
        this._attack();
        this.cooldown = ATTACK_COOLDOWN;
      }
    }

    // Restore flashed enemy colors
    for (let i = this.flashing.length - 1; i >= 0; i--) {
      const f = this.flashing[i];
      f.timer -= delta;
      if (f.timer <= 0) {
        if (f.enemy.alive) f.enemy.mat.color.setHex(f.enemy.color);
        this.flashing.splice(i, 1);
      }
    }

    // Auto-collect nearby loot
    const pp = this.player.mesh.position;
    for (const l of this.loot) {
      if (l.collected) continue;
      const dx = pp.x - l.mesh.position.x;
      const dz = pp.z - l.mesh.position.z;
      if (dx * dx + dz * dz <= LOOT_PICKUP_SQ) l.collect();
    }
  }

  _attack() {
    const pp = this.player.mesh.position;
    let target = null;
    let bestDist = Infinity;

    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.mesh.position.x - pp.x;
      const dz = enemy.mesh.position.z - pp.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= ATTACK_RANGE && dist < bestDist) {
        target = enemy;
        bestDist = dist;
      }
    }

    if (!target) return;

    const dead = target.takeDamage(ATTACK_DAMAGE);

    if (dead) {
      this.loot.push(new Loot(this.scene, target.mesh.position.x, target.mesh.position.z));
    } else {
      target.mat.color.setHex(0xffffff);
      this.flashing.push({ enemy: target, timer: FLASH_DURATION });
    }
  }
}
