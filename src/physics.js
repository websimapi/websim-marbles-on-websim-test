import * as CANNON from "cannon-es";

export class PhysicsWorld {
  constructor() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0),
    });
    // contact materials
    this.defaultMaterial = new CANNON.Material("default");
    this.groundMaterial = new CANNON.Material("ground");
    this.ballMaterial = new CANNON.Material("ball");

    // mix: ball-ground friction + restitution tuned for realistic marbles
    this.world.defaultContactMaterial = new CANNON.ContactMaterial(this.defaultMaterial, this.defaultMaterial, {
      friction: 0.25,
      restitution: 0.25,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 3
    });

    this.world.broadphase = new CANNON.NaiveBroadphase();
    this.world.solver.iterations = 10;
    this.world.solver.tolerance = 1e-7;
  }

  initGround(y = 0) {
    // infinite plane: physics
    const groundBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      material: this.groundMaterial
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    groundBody.position.set(0, y, 0);
    this.world.addBody(groundBody);

    // contact between ball and ground: low friction, small restitution
    const cg = new CANNON.ContactMaterial(this.ballMaterial, this.groundMaterial, {
      friction: 0.18,
      restitution: 0.22,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 3
    });
    this.world.addContactMaterial(cg);

    // ball-ball contact
    const bb = new CANNON.ContactMaterial(this.ballMaterial, this.ballMaterial, {
      friction: 0.12,
      restitution: 0.28,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 3
    });
    this.world.addContactMaterial(bb);
  }

  addSphereBody(body, mesh) {
    // ensure body's material is ballMaterial
    body.material = this.ballMaterial;
    this.world.addBody(body);
  }

  step(dt) {
    // fixed-step loop with substeps for stability
    const fixedTimeStep = 1 / 120;
    const maxSubSteps = 3;
    this.world.step(fixedTimeStep, dt, maxSubSteps);
  }
}