import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as CANNON from "cannon-es";
import nipplejs from "nipplejs";

import { PhysicsWorld } from "./physics.js";
import { PlayerControls } from "./controls.js";

const container = document.getElementById("app");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b0b);

// Camera
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 6, 10);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.physicallyCorrectLights = true;
container.appendChild(renderer.domElement);

// Lights - minimalistic but realistic
const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.35);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 0.9);
dir.position.set(8, 12, 6);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.camera.left = -12;
dir.shadow.camera.right = 12;
dir.shadow.camera.top = 12;
dir.shadow.camera.bottom = -12;
scene.add(dir);

/* Ground: flat plane for collisions + visible grid overlay for a clear grid terrain */
const groundMat = new THREE.MeshStandardMaterial({ color: 0x0f1112, metalness: 0.02, roughness: 0.6 });
const groundGeo = new THREE.PlaneGeometry(80, 80);
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Grid helper to visualize flat grid terrain (slightly above plane to avoid z-fighting)
const grid = new THREE.GridHelper(80, 80, 0x2b2b2b, 0x151515);
grid.material.opacity = 0.9;
grid.material.transparent = true;
grid.position.y = 0.001;
scene.add(grid);

// subtle rim/backlight plane under the grid to deepen contrast
const reflectGeo = new THREE.PlaneGeometry(80, 80);
const reflectMat = new THREE.MeshPhysicalMaterial({ color: 0x090909, metalness: 0.1, roughness: 0.85, opacity: 0.82, transparent: true });
const reflect = new THREE.Mesh(reflectGeo, reflectMat);
reflect.rotation.x = -Math.PI / 2;
reflect.position.y = -0.002;
scene.add(reflect);

// Orbit controls for camera tuning on desktop (not primary control)
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.enablePan = false;
orbit.minDistance = 4;
orbit.maxDistance = 30;
orbit.maxPolarAngle = Math.PI * 0.49;
orbit.enabled = false; // disabled by default to keep marble focus, toggle for debug

// Physics
const physics = new PhysicsWorld();
physics.initGround(ground.position.y);

// Marble creation
const marbleRadius = 0.45;
const marble = createMarbleMesh(marbleRadius);
scene.add(marble.mesh);
physics.addSphereBody(marble.body, marble.mesh);

// spawn a few random marbles to show dynamics
const extras = [];
for (let i = 0; i < 6; i++) {
  const m = createMarbleMesh(marbleRadius * (0.9 + Math.random() * 0.4));
  m.mesh.position.set(-4 + Math.random() * 8, 1 + Math.random() * 2, -2 + Math.random() * 4);
  m.body.position.copy(m.mesh.position);
  m.body.velocity.set((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2);
  scene.add(m.mesh);
  physics.world.addBody(m.body);
  extras.push(m);
}

// Controls - WASD desktop, nipple mobile
const controls = new PlayerControls(marble.body, camera, { joyEl: document.getElementById("joy") });

// UI
document.getElementById("resetBtn").addEventListener("click", resetPlayer);
let lightOn = true;
document.getElementById("toggleLight").addEventListener("click", () => {
  lightOn = !lightOn;
  dir.visible = lightOn;
});

// Resize
window.addEventListener("resize", onResize);
function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

// FPS counter
let lastTime = performance.now(), frames = 0;
const fpsEl = document.getElementById("fps");

// Animation loop
let last = performance.now();
function animate(t) {
  requestAnimationFrame(animate);
  const dt = Math.min((t - last) / 1000, 1 / 30);
  last = t;

  // step physics
  physics.step(dt);

  // sync marble mesh positions
  updateMeshFromBody(marble);
  extras.forEach(updateMeshFromBody);

  controls.update(dt);

  orbit.update();
  renderer.render(scene, camera);

  // fps
  frames++;
  if (t - lastTime > 500) {
    const fps = Math.round((frames * 1000) / (t - lastTime));
    fpsEl.textContent = fps + " FPS";
    frames = 0;
    lastTime = t;
  }
}
requestAnimationFrame(animate);

// helpers
function createMarbleMesh(radius) {
  const geo = new THREE.SphereGeometry(radius, 48, 32);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0.1,
    roughness: 0.24,
    clearcoat: 0.9,
    clearcoatRoughness: 0.08,
    reflectivity: 0.25
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.position.set(0, 1.8, 0);

  const body = new CANNON.Body({
    mass: 1.0,
    shape: new CANNON.Sphere(radius),
    position: new CANNON.Vec3(mesh.position.x, mesh.position.y, mesh.position.z),
    material: physics.ballMaterial
  });
  body.linearDamping = 0.06;
  body.angularDamping = 0.06;

  return { mesh, body, radius };
}

function updateMeshFromBody(obj) {
  obj.mesh.position.copy(obj.body.position);
  obj.mesh.quaternion.set(obj.body.quaternion.x, obj.body.quaternion.y, obj.body.quaternion.z, obj.body.quaternion.w);
}

function resetPlayer() {
  marble.body.position.set(0, 1.8, 0);
  marble.body.velocity.setZero();
  marble.body.angularVelocity.setZero();
  marble.body.quaternion.set(0, 0, 0, 1);
  updateMeshFromBody(marble);
}

// expose for debugging in console
window._app = { scene, physics, marble, extras, controls, orbit };