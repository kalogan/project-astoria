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

export class NPC {
  constructor(scene, def) {
    this.id   = def.id;
    this.type = 'npc';
    this.name = def.name ?? def.id;

    const col    = def.color ?? 0xd4a96a;
    const npcMat = new THREE.MeshLambertMaterial({ color: col });
    const g      = new THREE.Group();

    // Body (tunic)
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.16, 0.70, 6),
      npcMat,
    );
    body.position.y = 0.35;
    g.add(body);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 7, 5),
      npcMat,
    );
    head.position.y = 0.875;
    g.add(head);

    // Staff pole
    const staffMat = new THREE.MeshLambertMaterial({ color: 0x7a5a28 });
    const staff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 1.3, 4),
      staffMat,
    );
    staff.position.set(0.22, 0.65, 0);
    g.add(staff);

    // Staff ornament
    const ornament = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.07, 0),
      new THREE.MeshLambertMaterial({ color: 0xf0c040, emissive: 0x604000, emissiveIntensity: 0.5 }),
    );
    ornament.position.set(0.22, 1.32, 0);
    g.add(ornament);

    g.position.set(def.x, 0, def.z);
    if (def.facing !== undefined) g.rotation.y = def.facing;
    g.castShadow = true;

    this.mesh = g;
    scene.add(this.mesh);
  }
}
