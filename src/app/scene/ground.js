import * as THREE from "three";

function createRigidBody({ Ammo, scene, physicsWorld, mesh, shape, mass }) {
  const transform = new Ammo.btTransform();
  transform.setIdentity();
  transform.setOrigin(
    new Ammo.btVector3(mesh.position.x, mesh.position.y, mesh.position.z)
  );
  transform.setRotation(
    new Ammo.btQuaternion(
      mesh.quaternion.x,
      mesh.quaternion.y,
      mesh.quaternion.z,
      mesh.quaternion.w
    )
  );
  const motionState = new Ammo.btDefaultMotionState(transform);
  const localInertia = new Ammo.btVector3(0, 0, 0);
  shape.calculateLocalInertia(mass, localInertia);
  const rbInfo = new Ammo.btRigidBodyConstructionInfo(
    mass,
    motionState,
    shape,
    localInertia
  );
  const body = new Ammo.btRigidBody(rbInfo);
  mesh.userData.physicsBody = body;
  scene.add(mesh);

  if (mass > 0) {
    body.setActivationState(4);
  }

  physicsWorld.addRigidBody(body);
  return body;
}

export function addGround({ Ammo, scene, physicsWorld, margin }) {
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x141b26,
    roughness: 0.9,
    metalness: 0.05,
  });
  const ground = new THREE.Mesh(new THREE.BoxGeometry(50, 1, 50), groundMaterial);
  ground.position.set(0, -5, 0);
  ground.receiveShadow = true;

  const shape = new Ammo.btBoxShape(
    new Ammo.btVector3(25, 0.5, 25)
  );
  shape.setMargin(margin);
  createRigidBody({
    Ammo,
    scene,
    physicsWorld,
    mesh: ground,
    shape,
    mass: 0,
  });

  return ground;
}
