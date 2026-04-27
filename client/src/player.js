import * as THREE from 'three';

const SPEED = 5;

export class Player {
  constructor(scene, collider) {
    this.collider = collider;
    this.keys = {};
    this.interactPressed = false;

    const geo = new THREE.BoxGeometry(0.6, 0.9, 0.6);
    const mat = new THREE.MeshLambertMaterial({ color: 0x00d4ff });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(0, 0.65, 0);
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (k === 'e') this.interactPressed = true;
    });
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
  }

  consumeInteract() {
    const v = this.interactPressed;
    this.interactPressed = false;
    return v;
  }

  update(delta) {
    const dir = new THREE.Vector3();
    if (this.keys['w']) dir.z -= 1;
    if (this.keys['s']) dir.z += 1;
    if (this.keys['a']) dir.x -= 1;
    if (this.keys['d']) dir.x += 1;

    if (dir.lengthSq() === 0) return;

    dir.normalize().multiplyScalar(SPEED * delta);

    const { x, z } = this.mesh.position;
    if (this.collider.passable(x + dir.x, z))               this.mesh.position.x += dir.x;
    if (this.collider.passable(this.mesh.position.x, z + dir.z)) this.mesh.position.z += dir.z;
  }
}
