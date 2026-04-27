import * as THREE from 'three';

const UNLOCKED_COLOR = 0x00e676;

export class Key {
  constructor(scene, def) {
    this.id    = def.id;
    this.keyId = def.keyId;
    this.collected = false;

    const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const mat = new THREE.MeshLambertMaterial({ color: def.color });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(def.x, 0.8, def.z);
    this.mesh.castShadow = true;
    scene.add(this.mesh);
  }

  collect() {
    this.collected = true;
    this.mesh.visible = false;
  }
}

export class Door {
  constructor(scene, def) {
    this.id    = def.id;
    this.keyId = def.keyId;
    this.locked = true;

    const geo  = new THREE.BoxGeometry(0.8, 1.5, 0.8);
    this.mat   = new THREE.MeshLambertMaterial({ color: def.color });
    this.mesh  = new THREE.Mesh(geo, this.mat);
    this.mesh.position.set(def.x, 0.75, def.z);
    this.mesh.castShadow = true;
    scene.add(this.mesh);
  }

  unlock() {
    this.locked = false;
    this.mat.color.setHex(UNLOCKED_COLOR);
  }
}
