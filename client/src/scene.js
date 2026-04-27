import * as THREE from 'three';

// frustumSize is mutable — updated per zone by setFrustumSize()
let _frustumSize = 22;

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
  document.body.appendChild(renderer.domElement);

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 1.0);
  directional.position.set(15, 30, 15);
  directional.castShadow = true;
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
