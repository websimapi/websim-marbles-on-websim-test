import * as THREE from "three";
import * as CANNON from "cannon-es";

/*
  Touch-first PlayerControls:
  - single-finger drag: move input (sets this.move.x / this.move.z)
  - two-finger drag: pans camera focus offset
  - tap on ball: hold while dragging (kinematic), tap duration charges impulse; on release apply impulse away from camera scaled by hold duration
  - no external UI used
*/

export class PlayerControls {
  constructor(body, camera, opts = {}) {
    this.body = body;
    this.camera = camera;
    this.scene = opts.scene;
    this.dom = opts.domElement || window;
    this.world = opts.world;
    this.extrasBodies = opts.extrasBodies || [];
    this.move = { x: 0, z: 0 };
    this.force = 12; // torque/force multiplier
    this._followOffset = { x: 0, y: 2.6, z: 5.6 };

    // touch/raycast helpers
    this._raycaster = new THREE.Raycaster();
    this._touchState = { pointers: new Map(), lastSinglePos: null, panOffset: { x: 0, z: 0 } };

    // interaction state for tapping balls
    this._held = null; // { body, pointerId, startTime, startPos }
    this._tapCharge = 0;

    this._initKeys(); // still allow keyboard for non-touch
    this._initTouch();

    this._updateCameraImmediate();
  }

  _initKeys() {
    // keep keyboard controls on non-touch platforms
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return;

    const keys = {};
    const keyMap = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] };
    window.addEventListener("keydown", (e) => {
      if (keyMap[e.code]) keys[e.code] = true;
      this._updateMoveFromKeys(keys, keyMap);
    });
    window.addEventListener("keyup", (e) => {
      if (keyMap[e.code]) delete keys[e.code];
      this._updateMoveFromKeys(keys, keyMap);
    });
  }

  _updateMoveFromKeys(keys, map) {
    let mx = 0, mz = 0;
    for (const k of Object.keys(keys)) {
      const v = map[k];
      mx += v[0]; mz += v[1];
    }
    this.move.x = Math.max(-1, Math.min(1, mx));
    this.move.z = Math.max(-1, Math.min(1, mz));
  }

  _initTouch() {
    // require scene and dom
    if (!this.scene || !this.dom) return;

    const el = this.dom;
    el.style.touchAction = "none";

    // keep a persistent panOffset (separate from followOffset) to accumulate two-finger pans
    this._touchState.panOffset = { x: 0, z: 0 };
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    const getTouchPosNDC = (touch) => {
      const r = el.getBoundingClientRect();
      return {
        x: ((touch.clientX - r.left) / r.width) * 2 - 1,
        y: -((touch.clientY - r.top) / r.height) * 2 + 1
      };
    };

    const pointerDown = (ev) => {
      ev.preventDefault();
      for (const t of ev.changedTouches) {
        this._touchState.pointers.set(t.identifier, { x: t.clientX, y: t.clientY });
      }

      // if single touch start, capture single pos and test for hits
      if (this._touchState.pointers.size === 1) {
        const first = ev.changedTouches[0];
        this._touchState.lastSinglePos = { x: first.clientX, y: first.clientY };

        const ndc = getTouchPosNDC(first);
        this._raycaster.setFromCamera(ndc, this.camera);
        const intersects = this._raycastBodies();
        if (intersects.length) {
          const hit = intersects[0];
          const body = hit.body;
          this._held = { body, pointerId: first.identifier, startTime: performance.now(), startPos: { ...this._touchState.lastSinglePos } };
          // hold as kinematic for direct placement
          body.type = CANNON.Body.KINEMATIC;
          body.velocity.setZero();
          body.angularVelocity.setZero();
        }
      }
    };

    const pointerMove = (ev) => {
      ev.preventDefault();
      for (const t of ev.changedTouches) {
        if (!this._touchState.pointers.has(t.identifier)) continue;
        this._touchState.pointers.set(t.identifier, { x: t.clientX, y: t.clientY });
      }

      const count = this._touchState.pointers.size;
      if (count === 1) {
        // single-finger: movement input or dragging held ball
        const p = Array.from(this._touchState.pointers.values())[0];
        const last = this._touchState.lastSinglePos || p;
        const dx = p.x - last.x;
        const dy = p.y - last.y;
        // screen dx -> lateral; screen dy (drag up) should move forward, so invert sign
        const sensitivityX = 0.006;
        const sensitivityZ = 0.0065;
        this.move.x = clamp(dx * sensitivityX, -1, 1);
        this.move.z = clamp(-dy * sensitivityZ, -1, 1); // inverted so dragging up moves forward

        this._touchState.lastSinglePos = { x: p.x, y: p.y };

        // if holding a ball, place it on a plane under the touch
        if (this._held && this._held.pointerId === Array.from(this._touchState.pointers.keys())[0]) {
          const ndc = getTouchPosNDC({ clientX: p.x, clientY: p.y });
          this._raycaster.setFromCamera(ndc, this.camera);
          const planeY = 0.5;
          const target = this._rayIntersectPlaneY(planeY);
          if (target) {
            this._held.body.position.set(target.x, target.y + this._held.body.shapes[0].radius + 0.02, target.z);
            this._held.body.velocity.setZero();
            this._held.body.angularVelocity.setZero();
          }
        }
      } else if (count >= 2) {
        // two-finger: pan camera focus laterally in XZ plane using midpoint delta and accumulate into panOffset
        const pts = Array.from(this._touchState.pointers.values());
        const pA = pts[0], pB = pts[1];
        const mid = { x: (pA.x + pB.x) * 0.5, y: (pA.y + pB.y) * 0.5 };

        if (this._touchState._lastMid) {
          const mdx = mid.x - this._touchState._lastMid.x;
          const mdy = mid.y - this._touchState._lastMid.y;
          const panSensX = 0.01;
          const panSensZ = 0.008;
          // accumulate into panOffset rather than directly mutating followOffset
          this._touchState.panOffset.x += -mdx * panSensX;
          this._touchState.panOffset.z += mdy * panSensZ;
          // clamp panOffset to reasonable extents
          this._touchState.panOffset.x = clamp(this._touchState.panOffset.x, -8, 8);
          this._touchState.panOffset.z = clamp(this._touchState.panOffset.z, -6, 10);
        }
        this._touchState._lastMid = mid;

        // clear single-finger move so it doesn't interfere
        this.move.x = 0; this.move.z = 0;
        this._touchState.lastSinglePos = null;
      }
    };

    const pointerUp = (ev) => {
      ev.preventDefault();
      const releasedIds = [];
      for (const t of ev.changedTouches) {
        releasedIds.push(t.identifier);
        this._touchState.pointers.delete(t.identifier);
      }

      // if we released the held ball pointer, compute tap duration and apply impulse; otherwise if other fingers remain, keep hold
      if (this._held) {
        const releasedHeld = releasedIds.includes(this._held.pointerId);
        // if the held pointer was released, or no pointers remain, release the hold
        if (releasedHeld || this._touchState.pointers.size === 0) {
          const dur = Math.max(0, performance.now() - this._held.startTime);
          const charge = Math.min(1.8, dur / 400);
          const camPos = this.camera.position;
          const bpos = this._held.body.position;
          const dir = new CANNON.Vec3(bpos.x - camPos.x, bpos.y - camPos.y, bpos.z - camPos.z);
          dir.normalize();
          const impulseMag = 6 * charge * this._held.body.mass;
          const impulse = dir.scale(impulseMag);
          this._held.body.type = CANNON.Body.DYNAMIC;
          this._held.body.applyImpulse(impulse, this._held.body.position);
          this._held = null;
        }
      }

      // reset single-touch state if no pointers left
      if (this._touchState.pointers.size === 0) {
        this._touchState.lastSinglePos = null;
        this._touchState._lastMid = null;
        this.move.x = 0; this.move.z = 0;
      }
    };

    // attach listeners
    el.addEventListener("touchstart", pointerDown, { passive: false });
    el.addEventListener("touchmove", pointerMove, { passive: false });
    el.addEventListener("touchend", pointerUp, { passive: false });
    el.addEventListener("touchcancel", pointerUp, { passive: false });
  }

  _raycastBodies() {
    // perform raycast against cannon bodies (marble and extras). We approximate by intersecting THREE meshes attached to bodies via position equality.
    // The scene is expected to have THREE Meshes that match Cannon bodies by position; instead we'll test against the scene objects under raycaster.
    if (!this.scene) return [];
    // raycaster intersects THREE meshes; return array with .body property if attached
    const intersects = this._raycaster.intersectObjects(this.scene.children, true);
    // map to cannon bodies by checking userData.body or matching positions (common pattern: meshes may not have body references)
    const hits = [];
    for (const it of intersects) {
      // prefer object.userData.body if present
      const obj = it.object;
      const body = obj.userData && obj.userData.body ? obj.userData.body : this._findBodyByPosition(obj.position);
      if (body) hits.push({ object: obj, body, point: it.point, distance: it.distance });
    }
    return hits;
  }

  _findBodyByPosition(pos) {
    // simple epsilon match to extras or player body
    const eps = 0.1;
    if (!this.world) return null;
    const all = [this.body, ...this.extrasBodies];
    for (const b of all) {
      if (!b) continue;
      const dx = b.position.x - pos.x, dy = b.position.y - pos.y, dz = b.position.z - pos.z;
      if (dx*dx + dy*dy + dz*dz < eps*eps) return b;
    }
    return null;
  }

  _rayIntersectPlaneY(y) {
    // return intersection point of current ray with plane Y = y
    const origin = this._raycaster.ray.origin;
    const dir = this._raycaster.ray.direction;
    if (Math.abs(dir.y) < 1e-6) return null;
    const t = (y - origin.y) / dir.y;
    if (t < 0) return null;
    const p = origin.clone().add(dir.clone().multiplyScalar(t));
    return { x: p.x, y: p.y, z: p.z };
  }

  update(dt) {
    // same movement application for single-finger drive
    const input = this.move;

    const dir = new CANNON.Vec3(input.x, 0, input.z);
    if (dir.lengthSquared() > 0.0001) {
      dir.normalize();
      const force = dir.scale(this.force * this.body.mass);
      const impulse = force.scale(dt * 60);
      this.body.applyImpulse(impulse, this.body.position);
      const ang = new CANNON.Vec3(-dir.z, 0, dir.x).scale(0.02 * this.body.mass);
      this.body.applyLocalImpulse(ang, new CANNON.Vec3(0, 0, 0));
    } else {
      this.body.angularDamping = 0.08;
    }

    // if a ball is held kinematically, ensure it stays kinematic and synced (no extra action needed)

    this._updateCamera(dt);
  }

  _updateCamera(dt) {
    // follow behind the marble smoothly, but include pan offsets
    const pos = this.body.position;
    const desired = {
      x: pos.x + this._followOffset.x + (this._touchState.panOffset ? this._touchState.panOffset.x : 0),
      y: pos.y + this._followOffset.y,
      z: pos.z + this._followOffset.z + (this._touchState.panOffset ? this._touchState.panOffset.z : 0)
    };

    this.camera.position.x += (desired.x - this.camera.position.x) * Math.min(0.12, dt * 8);
    this.camera.position.y += (desired.y - this.camera.position.y) * Math.min(0.12, dt * 8);
    this.camera.position.z += (desired.z - this.camera.position.z) * Math.min(0.12, dt * 8);

    const lookAt = {
      x: pos.x + (this.body.velocity.x * 0.08),
      y: pos.y + 0.4,
      z: pos.z + (this.body.velocity.z * 0.08)
    };
    this.camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
  }

  _updateCameraImmediate() {
    const pos = this.body.position;
    this.camera.position.set(pos.x + this._followOffset.x, pos.y + this._followOffset.y, pos.z + this._followOffset.z);
    this.camera.lookAt(pos.x, pos.y + 0.4, pos.z);
  }
}