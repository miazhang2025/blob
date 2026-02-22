import * as THREE from "three";
import { BLOB_CONFIG } from "./blobConfig";
import {
  applyAnchorForces,
  applyRestDamping,
  createBlobs,
  syncSoftBodies,
} from "./blob";
import { addGround } from "./ground";
import { initControls } from "./controls";
import { createDragController } from "./interaction";

function loadAmmo() {
  return new Promise((resolve, reject) => {
    if (window.Ammo) {
      if (typeof window.Ammo === "function") {
        window.Ammo().then(resolve).catch(reject);
      } else {
        resolve(window.Ammo);
      }
      return;
    }

    const script = document.createElement("script");
    script.src =
      "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/ammo.wasm.js";
    script.async = true;
    script.onload = () => window.Ammo().then(resolve).catch(reject);
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

export function initBlobScene(container) {
  let Ammo;
  let renderer;
  let scene;
  let camera;
  let controls;
  let animationId;
  let physicsWorld;
  let transformAux1;
  let softBodyHelpers;
  const rigidBodies = [];
  const softBodies = [];
  let destroyed = false;
  let dragController;

  const clock = new THREE.Clock();

  function initGraphics() {
    if (!container) return;

    camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.2,
      2000
    );
    camera.position.set(0, 4, 8);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f16);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    controls = initControls(camera, renderer);

    const ambientLight = new THREE.AmbientLight(0x9aa3b2, 0.6);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(-10, 12, 8);
    keyLight.castShadow = true;
    keyLight.shadow.camera.left = -20;
    keyLight.shadow.camera.right = 20;
    keyLight.shadow.camera.top = 20;
    keyLight.shadow.camera.bottom = -20;
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 50;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x6c7cff, 0.8);
    rimLight.position.set(12, 6, -10);
    scene.add(rimLight);
  }

  function initPhysics() {
    const collisionConfiguration =
      new Ammo.btSoftBodyRigidBodyCollisionConfiguration();
    const dispatcher = new Ammo.btCollisionDispatcher(collisionConfiguration);
    const broadphase = new Ammo.btDbvtBroadphase();
    const solver = new Ammo.btSequentialImpulseConstraintSolver();
    const softBodySolver = new Ammo.btDefaultSoftBodySolver();
    physicsWorld = new Ammo.btSoftRigidDynamicsWorld(
      dispatcher,
      broadphase,
      solver,
      collisionConfiguration,
      softBodySolver
    );
    physicsWorld.setGravity(new Ammo.btVector3(0, BLOB_CONFIG.gravity, 0));
    physicsWorld
      .getWorldInfo()
      .set_m_gravity(new Ammo.btVector3(0, BLOB_CONFIG.gravity, 0));
    transformAux1 = new Ammo.btTransform();
    softBodyHelpers = new Ammo.btSoftBodyHelpers();
  }

  async function createObjects() {
    addGround({
      Ammo,
      scene,
      physicsWorld,
      margin: BLOB_CONFIG.margin,
    });
    await createBlobs({
      Ammo,
      softBodyHelpers,
      physicsWorld,
      scene,
      config: BLOB_CONFIG,
      softBodies,
    });
  }

  function updatePhysics(deltaTime) {
    applyAnchorForces({
      Ammo,
      softBodies,
      anchorPosition: BLOB_CONFIG.anchorPosition,
      anchorStrength: BLOB_CONFIG.anchorStrength,
    });
    if (dragController) {
      dragController.applyDragForce();
    }
    applyRestDamping({
      softBodies,
      anchorPosition: BLOB_CONFIG.anchorPosition,
      restSpeedThreshold: BLOB_CONFIG.restSpeedThreshold,
      restDistanceThreshold: BLOB_CONFIG.restDistanceThreshold,
      restPositionBlend: BLOB_CONFIG.restPositionBlend,
      restVelocityLerp: BLOB_CONFIG.restVelocityLerp,
      isDragging: dragController ? dragController.isDragging() : false,
    });
    physicsWorld.stepSimulation(deltaTime, 10);
    syncSoftBodies({ softBodies });
    for (let i = 0; i < rigidBodies.length; i += 1) {
      const objThree = rigidBodies[i];
      const objPhys = objThree.userData.physicsBody;
      const ms = objPhys.getMotionState();
      if (ms) {
        ms.getWorldTransform(transformAux1);
        const p = transformAux1.getOrigin();
        const q = transformAux1.getRotation();
        objThree.position.set(p.x(), p.y(), p.z());
        objThree.quaternion.set(q.x(), q.y(), q.z(), q.w());
      }
    }
  }

  function onWindowResize() {
    if (!container || !camera || !renderer) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  }

  function animate() {
    const deltaTime = clock.getDelta();
    updatePhysics(deltaTime);
    renderer.render(scene, camera);
    animationId = requestAnimationFrame(animate);
  }

  function cleanup() {
    destroyed = true;
    window.removeEventListener("resize", onWindowResize);
    if (renderer && renderer.domElement) {
      if (dragController) {
        renderer.domElement.removeEventListener(
          "pointerdown",
          dragController.onPointerDown
        );
        renderer.domElement.removeEventListener(
          "pointermove",
          dragController.onPointerMove
        );
        renderer.domElement.removeEventListener(
          "pointerup",
          dragController.onPointerUp
        );
        renderer.domElement.removeEventListener(
          "pointerleave",
          dragController.onPointerUp
        );
      }
    }
    if (animationId) cancelAnimationFrame(animationId);
    if (controls) controls.dispose();
    if (renderer) {
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    }
    rigidBodies.length = 0;
    softBodies.length = 0;
  }

  loadAmmo()
    .then(async (ammoLib) => {
      if (destroyed) return;
      Ammo = ammoLib;
      window.Ammo = ammoLib;
      initGraphics();
      initPhysics();
      await createObjects();
      dragController = createDragController({
        Ammo,
        camera,
        renderer,
        softBodies,
        anchorPosition: BLOB_CONFIG.anchorPosition,
        dragDistanceScale: BLOB_CONFIG.dragDistanceScale,
        dragStrength: BLOB_CONFIG.dragStrength,
      });
      renderer.domElement.addEventListener(
        "pointerdown",
        dragController.onPointerDown
      );
      renderer.domElement.addEventListener(
        "pointermove",
        dragController.onPointerMove
      );
      renderer.domElement.addEventListener("pointerup", dragController.onPointerUp);
      renderer.domElement.addEventListener(
        "pointerleave",
        dragController.onPointerUp
      );
      window.addEventListener("resize", onWindowResize);
      animate();
    })
    .catch((error) => {
      console.error("Scene init failed.", error);
    });

  return cleanup;
}
