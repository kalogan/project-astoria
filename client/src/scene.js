import * as THREE from 'three';

// frustumSize is mutable — updated per zone by setFrustumSize()
// Tight Astonia-style default: player fills ~30 % of screen height.
let _frustumSize = 13;

export function setFrustumSize(camera, renderer, size) {
  _frustumSize = size;
  const a = window.innerWidth / window.innerHeight;
  camera.left   = (_frustumSize * a) / -2;
  camera.right  = (_frustumSize * a) /  2;
  camera.top    =  _frustumSize / 2;
  camera.bottom =  _frustumSize / -2;
  camera.updateProjectionMatrix();
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  // Large background plane — hides the void at zone edges
  const bgPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshLambertMaterial({ color: 0x12121e })
  );
  bgPlane.rotation.x = -Math.PI / 2;
  bgPlane.position.y = -0.05;
  scene.add(bgPlane);

  // Isometric orthographic camera
  const aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.OrthographicCamera(
    (_frustumSize * aspect) / -2,
    (_frustumSize * aspect) /  2,
     _frustumSize / 2,
     _frustumSize / -2,
    0.1, 1000
  );
  camera.position.set(20, 20, 20);
  camera.lookAt(0, 0, 0);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;   // soft shadow edges
  document.body.appendChild(renderer.domElement);

  // ── Lighting ───────────────────────────────────────────────────────────────
  //
  // HemisphereLight replaces flat AmbientLight.  It shines warm sky-colour from
  // above and a dark earthy colour from below, giving every vertical surface a
  // natural top/bottom gradient without any per-tile work.
  //
  // Palette:  sky  = soft afternoon gold
  //           ground = deep shadow brown
  const hemi = new THREE.HemisphereLight(0xffe8c0, 0x1c140a, 0.70);
  scene.add(hemi);

  // Key directional light — slightly north-west angle for good isometric shadow
  // direction (shadows fall to the south-east, matching the camera's viewing angle).
  const directional = new THREE.DirectionalLight(0xfff5e0, 0.95);
  directional.position.set(10, 28, 16);
  directional.castShadow = true;

  // Shadow map: 2048 px gives crisp prop/wall shadows without artefacts.
  // Camera bounds ±48 cover every authored zone (Cameron is 64-wide = ±32).
  directional.shadow.mapSize.set(2048, 2048);
  directional.shadow.camera.left   = -48;
  directional.shadow.camera.right  =  48;
  directional.shadow.camera.top    =  48;
  directional.shadow.camera.bottom = -48;
  directional.shadow.camera.near   =  1;
  directional.shadow.camera.far    =  160;
  directional.shadow.bias          = -0.0003;   // reduce shadow acne on flat tiles

  scene.add(directional);

  window.addEventListener('resize', () => {
    const a = window.innerWidth / window.innerHeight;
    camera.left   = (_frustumSize * a) / -2;
    camera.right  = (_frustumSize * a) /  2;
    camera.top    =  _frustumSize / 2;
    camera.bottom =  _frustumSize / -2;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, renderer };
}
