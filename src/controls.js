import * as CANNON from "cannon-es";
import nipplejs from "nipplejs";

export class PlayerControls {
  constructor(body, camera, opts = {}) {
    this.body = body;
    this.camera = camera;
    this.move = { x: 0, z: 0 };
    this.force = 12; // torque/force multiplier

    this._initKeys();
    this._initNipple(opts.joyEl);
    this._followOffset = { x: 0, y: 2.6, z: 5.6 };
    this._updateCameraImmediate();
  }

  _initKeys() {
    // Disable keyboard handlers on touch devices to prioritize mobile controls.
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

  _initNipple(joyEl) {
    if (!joyEl) return;
    const manager = nipplejs.create({ zone: joyEl, size: 100, multitouch: false, mode: "dynamic", color: "#fff" });
    manager.on("move", (evt, data) => {
      const dist = Math.min(1, (data.distance || 0) / 50);
      const angle = (data.angle ? data.angle.radian : 0);
      this.move.x = Math.sin(angle) * dist;
      this.move.z = -Math.cos(angle) * dist;
    });
    manager.on("end", () => { this.move.x = 0; this.move.z = 0; });
  }

  update(dt) {
    // convert move into torque applied to sphere to roll realistically
    const input = this.move;
    const lv = this.body.velocity.length();

    // goal: apply torque perpendicular to desired direction to roll sphere
    // compute world-space direction on XZ plane
    const dir = new CANNON.Vec3(input.x, 0, input.z);
    if (dir.lengthSquared() > 0.0001) {
      dir.normalize();
      // apply a force at the contact point offset to create rolling torque, scaled by mass and dt
      const force = dir.scale(this.force * this.body.mass);
      // apply impulse to center to accelerate
      const impulse = force.scale(dt * 60); // scale to be framerate-insensitive
      this.body.applyImpulse(impulse, this.body.position);
      // Apply slight angular impulse to encourage rolling instead of sliding
      const ang = new CANNON.Vec3(-dir.z, 0, dir.x).scale(0.02 * this.body.mass);
      this.body.applyLocalImpulse(ang, new CANNON.Vec3(0, 0, 0));
    } else {
      // small stabilization damping when no input
      this.body.angularDamping = 0.08;
    }

    this._updateCamera(dt);
  }

  _updateCamera(dt) {
    // follow behind the marble smoothly
    const pos = this.body.position;
    const desired = {
      x: pos.x + this._followOffset.x,
      y: pos.y + this._followOffset.y,
      z: pos.z + this._followOffset.z
    };

    // lerp camera position
    this.camera.position.x += (desired.x - this.camera.position.x) * Math.min(0.12, dt * 8);
    this.camera.position.y += (desired.y - this.camera.position.y) * Math.min(0.12, dt * 8);
    this.camera.position.z += (desired.z - this.camera.position.z) * Math.min(0.12, dt * 8);

    // look at ball with slight lead
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