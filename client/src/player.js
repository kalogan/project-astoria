import * as THREE from 'three';

const SPEED = 5; // units per second

export class Player {
  constructor(scene) {
    this.keys = {};

    const geo = new THREE.BoxGeometry(0.6, 0.9, 0.6);
    const mat = new THREE.MeshLambertMaterial({ color: 0x00d4ff });
    this.mesh = new THREE.Mesh(geo, mat);
    // floor tile top surface is at y=0.2, player half-height is 0.45
    this.mesh.position.set(0, 0.65, 0);
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    window.addEventListener('keydown', e => { this.keys[e.key.toLowerCase()] = true; });
    window.addEventListener('keyup',   e => { this.keys[e.key.toLowerCase()] = false; });
  }

  update(delta) {
    const dir = new THREE.Vector3();
    if (this.keys['w']) dir.z -= 1;
    if (this.keys['s']) dir.z += 1;
    if (this.keys['a']) dir.x -= 1;
    if (this.keys['d']) dir.x += 1;

    if (dir.lengthSq() > 0) {
      dir.normalize().multiplyScalar(SPEED * delta);
      this.mesh.position.add(dir);
    }
  }
}
