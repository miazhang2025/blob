"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

const BLOB_COUNT = 1;
const BLOB_RADIUS = 2;
const GRAVITY = 0;
const MARGIN = 0.01;
const ANCHOR_POSITION = new THREE.Vector3(0, 1.5, 0);
const ANCHOR_STRENGTH = 20;
const DRAG_STRENGTH = 5;
const DRAG_DISTANCE_SCALE = 200;
const SOFT_PRESSURE = 3000;
const SOFT_DAMPING = 0.02;
const SOFT_STIFFNESS = 0.08;
const REST_SPEED_THRESHOLD = 1;
const REST_DISTANCE_THRESHOLD = 1;
const REST_POSITION_BLEND = 0.01;
const REST_VELOCITY_LERP = 0.3;

function loadAmmo() {
  return new Promise((resolve, reject) => {
    if (window.Ammo) {
      window.Ammo().then(resolve).catch(reject);
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

export default function Home() {
  const containerRef = useRef(null);

  useEffect(() => {
    let Ammo;
    let renderer;
    let scene;
    let camera;
    let controls;
    let animationId;
    let physicsWorld;
    let transformAux1;
    let softBodyHelpers;
    let raycaster;
    const rigidBodies = [];
    const softBodies = [];
    let destroyed = false;
    const dragState = {
      active: false,
      index: -1,
      nodeIndex: -1,
      plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
      target: new THREE.Vector3(),
    };
    const dragOffset = new THREE.Vector3();

    const clock = new THREE.Clock();

    function createParallelepiped(sx, sy, sz, mass, position, quaternion, material) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(sx, sy, sz, 1, 1, 1),
        material
      );
      const shape = new Ammo.btBoxShape(
        new Ammo.btVector3(sx * 0.5, sy * 0.5, sz * 0.5)
      );
      shape.setMargin(MARGIN);
      createRigidBody(mesh, shape, mass, position, quaternion);
      return mesh;
    }

    function createRigidBody(mesh, shape, mass, position, quaternion) {
      mesh.position.copy(position);
      mesh.quaternion.copy(quaternion);

      const transform = new Ammo.btTransform();
      transform.setIdentity();
      transform.setOrigin(new Ammo.btVector3(position.x, position.y, position.z));
      transform.setRotation(
        new Ammo.btQuaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
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
        rigidBodies.push(mesh);
        body.setActivationState(4);
      }

      physicsWorld.addRigidBody(body);
      return body;
    }

    function processGeometry(bufferGeom) {
      const posOnlyBufferGeom = new THREE.BufferGeometry();
      posOnlyBufferGeom.setAttribute("position", bufferGeom.getAttribute("position"));
      posOnlyBufferGeom.setIndex(bufferGeom.getIndex());

      const indexedBufferGeom = BufferGeometryUtils.mergeVertices(posOnlyBufferGeom);
      mapIndices(bufferGeom, indexedBufferGeom);
    }

    function isEqual(x1, y1, z1, x2, y2, z2) {
      const delta = 0.000001;
      return (
        Math.abs(x2 - x1) < delta &&
        Math.abs(y2 - y1) < delta &&
        Math.abs(z2 - z1) < delta
      );
    }

    function mapIndices(bufferGeom, indexedBufferGeom) {
      const vertices = bufferGeom.attributes.position.array;
      const idxVertices = indexedBufferGeom.attributes.position.array;
      const indices = indexedBufferGeom.index.array;
      const numIdxVertices = idxVertices.length / 3;
      const numVertices = vertices.length / 3;

      bufferGeom.ammoVertices = idxVertices;
      bufferGeom.ammoIndices = indices;
      bufferGeom.ammoIndexAssociation = [];

      for (let i = 0; i < numIdxVertices; i += 1) {
        const association = [];
        bufferGeom.ammoIndexAssociation.push(association);
        const i3 = i * 3;

        for (let j = 0; j < numVertices; j += 1) {
          const j3 = j * 3;
          if (
            isEqual(
              idxVertices[i3],
              idxVertices[i3 + 1],
              idxVertices[i3 + 2],
              vertices[j3],
              vertices[j3 + 1],
              vertices[j3 + 2]
            )
          ) {
            association.push(j3);
          }
        }
      }
    }

    function createSoftVolume(bufferGeom, mass, pressure, material) {
      processGeometry(bufferGeom);
      const volume = new THREE.Mesh(bufferGeom, material);
      volume.castShadow = true;
      volume.receiveShadow = true;
      volume.frustumCulled = false;
      scene.add(volume);

      const volumeSoftBody = softBodyHelpers.CreateFromTriMesh(
        physicsWorld.getWorldInfo(),
        bufferGeom.ammoVertices,
        bufferGeom.ammoIndices,
        bufferGeom.ammoIndices.length / 3,
        true
      );
      const sbConfig = volumeSoftBody.get_m_cfg();
      sbConfig.set_viterations(60);
      sbConfig.set_piterations(60);
      sbConfig.set_collisions(0x11);
      sbConfig.set_kDF(0.2);
      sbConfig.set_kDP(SOFT_DAMPING);
      sbConfig.set_kPR(pressure);
      volumeSoftBody.get_m_materials().at(0).set_m_kLST(SOFT_STIFFNESS);
      volumeSoftBody.get_m_materials().at(0).set_m_kAST(SOFT_STIFFNESS);
      volumeSoftBody.setTotalMass(mass, false);
      Ammo.castObject(volumeSoftBody, Ammo.btCollisionObject)
        .getCollisionShape()
        .setMargin(MARGIN);
      physicsWorld.addSoftBody(volumeSoftBody, 1, -1);
      volume.userData.physicsBody = volumeSoftBody;
      volumeSoftBody.setActivationState(4);
      softBodies.push(volume);
    }

    function initGraphics() {
      const container = containerRef.current;
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

      raycaster = new THREE.Raycaster();

      controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 2, 0);
      controls.update();
      controls.enabled = false;

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
      physicsWorld.setGravity(new Ammo.btVector3(0, GRAVITY, 0));
      physicsWorld
        .getWorldInfo()
        .set_m_gravity(new Ammo.btVector3(0, GRAVITY, 0));
      transformAux1 = new Ammo.btTransform();
      softBodyHelpers = new Ammo.btSoftBodyHelpers();
    }

    function createObjects() {
      const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x141b26,
        roughness: 0.9,
        metalness: 0.05,
      });
      const blobMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xff8b7a,
        roughness: 0.18,
        metalness: 0.18,
        clearcoat: 0.35,
      });

      const groundPos = new THREE.Vector3(0, -5, 0);
      const groundQuat = new THREE.Quaternion(0, 0, 0, 1);
      const ground = createParallelepiped(
        50,
        1,
        50,
        0,
        groundPos,
        groundQuat,
        groundMaterial
      );
      ground.receiveShadow = true;

      for (let i = 0; i < BLOB_COUNT; i += 1) {
        const geometry = new THREE.SphereGeometry(BLOB_RADIUS, 32, 24);
        geometry.translate(
          ANCHOR_POSITION.x,
          ANCHOR_POSITION.y,
          ANCHOR_POSITION.z
        );
        const material = blobMaterial.clone();
        material.color.setHSL(0.03 + i * 0.08, 0.75, 0.6);
        createSoftVolume(geometry, 50, SOFT_PRESSURE, material);
      }
    }

    function updateDragTarget(event) {
      if (!raycaster || !camera || !renderer) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
      raycaster.ray.intersectPlane(dragState.plane, dragState.target);
      dragState.target.z = ANCHOR_POSITION.z;
      dragOffset
        .copy(dragState.target)
        .sub(ANCHOR_POSITION)
        .multiplyScalar(DRAG_DISTANCE_SCALE);
      dragState.target.copy(ANCHOR_POSITION).add(dragOffset);
    }

    function onPointerDown(event) {
      if (!raycaster || !camera || !renderer) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(softBodies, false);
      if (intersects.length) {
        const hit = intersects[0];
        dragState.active = true;
        dragState.index = softBodies.indexOf(hit.object);
        dragState.plane.constant = -ANCHOR_POSITION.z;
        dragState.target.copy(hit.point);
        const softBody = hit.object.userData.physicsBody;
        const nodes = softBody.get_m_nodes();
        const numNodes = nodes.size();
        let bestIndex = -1;
        let bestDistance = Infinity;
        for (let i = 0; i < numNodes; i += 1) {
          const nodePos = nodes.at(i).get_m_x();
          const dx = nodePos.x() - hit.point.x;
          const dy = nodePos.y() - hit.point.y;
          const dz = nodePos.z() - hit.point.z;
          const distance = dx * dx + dy * dy + dz * dz;
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
          }
        }
        dragState.nodeIndex = bestIndex;
        return;
      }
    }

    function onPointerMove(event) {
      if (!dragState.active) return;
      updateDragTarget(event);
    }

    function onPointerUp() {
      dragState.active = false;
      dragState.index = -1;
      dragState.nodeIndex = -1;
    }

    function applyDragForce() {
      if (!dragState.active || dragState.index < 0) return;
      const volume = softBodies[dragState.index];
      if (!volume) return;
      const softBody = volume.userData.physicsBody;
      const nodes = softBody.get_m_nodes();
      const numNodes = nodes.size();
      if (numNodes === 0) return;

      if (dragState.nodeIndex >= 0 && dragState.nodeIndex < numNodes) {
        const nodePos = nodes.at(dragState.nodeIndex).get_m_x();
        const force = new Ammo.btVector3(
          (dragState.target.x - nodePos.x()) * DRAG_STRENGTH,
          (dragState.target.y - nodePos.y()) * DRAG_STRENGTH,
          (dragState.target.z - nodePos.z()) * DRAG_STRENGTH
        );
        softBody.addForce(force, dragState.nodeIndex);
        Ammo.destroy(force);
      }

    }

    function applyAnchorForces() {
      for (let i = 0; i < softBodies.length; i += 1) {
        const volume = softBodies[i];
        const softBody = volume.userData.physicsBody;
        const nodes = softBody.get_m_nodes();
        const numNodes = nodes.size();
        if (numNodes === 0) continue;

        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        const step = Math.max(1, Math.floor(numNodes / 24));
        let count = 0;
        for (let j = 0; j < numNodes; j += step) {
          const nodePos = nodes.at(j).get_m_x();
          sumX += nodePos.x();
          sumY += nodePos.y();
          sumZ += nodePos.z();
          count += 1;
        }

        const centerX = sumX / count;
        const centerY = sumY / count;
        const centerZ = sumZ / count;
        const anchorForce = new Ammo.btVector3(
          (ANCHOR_POSITION.x - centerX) * ANCHOR_STRENGTH,
          (ANCHOR_POSITION.y - centerY) * ANCHOR_STRENGTH,
          (ANCHOR_POSITION.z - centerZ) * ANCHOR_STRENGTH
        );
        softBody.addForce(anchorForce);
        Ammo.destroy(anchorForce);
      }
    }

    function applyRestDamping() {
      if (dragState.active) return;
      for (let i = 0; i < softBodies.length; i += 1) {
        const volume = softBodies[i];
        const softBody = volume.userData.physicsBody;
        const nodes = softBody.get_m_nodes();
        const numNodes = nodes.size();
        if (numNodes === 0) continue;

        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        let velSumX = 0;
        let velSumY = 0;
        let velSumZ = 0;
        const step = Math.max(1, Math.floor(numNodes / 24));
        let count = 0;
        for (let j = 0; j < numNodes; j += step) {
          const node = nodes.at(j);
          const nodePos = node.get_m_x();
          const nodeVel = node.get_m_v();
          sumX += nodePos.x();
          sumY += nodePos.y();
          sumZ += nodePos.z();
          velSumX += nodeVel.x();
          velSumY += nodeVel.y();
          velSumZ += nodeVel.z();
          count += 1;
        }

        const centerX = sumX / count;
        const centerY = sumY / count;
        const centerZ = sumZ / count;
        const speedX = velSumX / count;
        const speedY = velSumY / count;
        const speedZ = velSumZ / count;
        const speed = Math.hypot(speedX, speedY, speedZ);
        const distance = Math.hypot(
          centerX - ANCHOR_POSITION.x,
          centerY - ANCHOR_POSITION.y,
          centerZ - ANCHOR_POSITION.z
        );

        if (speed > REST_SPEED_THRESHOLD || distance > REST_DISTANCE_THRESHOLD) {
          continue;
        }

        for (let j = 0; j < numNodes; j += 1) {
          const node = nodes.at(j);
          const nodePos = node.get_m_x();
          const nodeVel = node.get_m_v();
          nodeVel.setValue(
            nodeVel.x() * (1 - REST_VELOCITY_LERP),
            nodeVel.y() * (1 - REST_VELOCITY_LERP),
            nodeVel.z() * (1 - REST_VELOCITY_LERP)
          );
          nodePos.setValue(
            nodePos.x() + (ANCHOR_POSITION.x - centerX) * REST_POSITION_BLEND,
            nodePos.y() + (ANCHOR_POSITION.y - centerY) * REST_POSITION_BLEND,
            nodePos.z() + (ANCHOR_POSITION.z - centerZ) * REST_POSITION_BLEND
          );
        }
      }
    }

    function updatePhysics(deltaTime) {
      applyAnchorForces();
      applyDragForce();
      applyRestDamping();
      physicsWorld.stepSimulation(deltaTime, 10);

      for (let i = 0; i < softBodies.length; i += 1) {
        const volume = softBodies[i];
        const geometry = volume.geometry;
        const softBody = volume.userData.physicsBody;
        const volumePositions = geometry.attributes.position.array;
        const volumeNormals = geometry.attributes.normal.array;
        const association = geometry.ammoIndexAssociation;
        const numVerts = association.length;
        const nodes = softBody.get_m_nodes();

        for (let j = 0; j < numVerts; j += 1) {
          const node = nodes.at(j);
          const nodePos = node.get_m_x();
          const nodeNormal = node.get_m_n();
          const x = nodePos.x();
          const y = nodePos.y();
          const z = nodePos.z();
          const nx = nodeNormal.x();
          const ny = nodeNormal.y();
          const nz = nodeNormal.z();
          const assocVertex = association[j];

          for (let k = 0; k < assocVertex.length; k += 1) {
            let indexVertex = assocVertex[k];
            volumePositions[indexVertex] = x;
            volumeNormals[indexVertex] = nx;
            indexVertex += 1;
            volumePositions[indexVertex] = y;
            volumeNormals[indexVertex] = ny;
            indexVertex += 1;
            volumePositions[indexVertex] = z;
            volumeNormals[indexVertex] = nz;
          }
        }

        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.normal.needsUpdate = true;
      }

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
      if (!containerRef.current || !camera || !renderer) return;
      camera.aspect =
        containerRef.current.clientWidth / containerRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(
        containerRef.current.clientWidth,
        containerRef.current.clientHeight
      );
    }

    function animate() {
      const deltaTime = clock.getDelta();
      updatePhysics(deltaTime);
      renderer.render(scene, camera);
      animationId = requestAnimationFrame(animate);
    }

    loadAmmo()
      .then((ammoLib) => {
        if (destroyed) return;
        Ammo = ammoLib;
        window.Ammo = ammoLib;
        initGraphics();
        initPhysics();
        createObjects();
        renderer.domElement.addEventListener("pointerdown", onPointerDown);
        renderer.domElement.addEventListener("pointermove", onPointerMove);
        renderer.domElement.addEventListener("pointerup", onPointerUp);
        renderer.domElement.addEventListener("pointerleave", onPointerUp);
        window.addEventListener("resize", onWindowResize);
        animate();
      })
      .catch(() => {});

    return () => {
      destroyed = true;
      window.removeEventListener("resize", onWindowResize);
      if (renderer && renderer.domElement) {
        renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        renderer.domElement.removeEventListener("pointermove", onPointerMove);
        renderer.domElement.removeEventListener("pointerup", onPointerUp);
        renderer.domElement.removeEventListener("pointerleave", onPointerUp);
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
    };
  }, []);

  return (
    <div className="scene-root">
      <div className="scene-ui">
        <div className="scene-note">
          DRAG ME CRAZY. Drag to stretch and release.
        </div>
      </div>
      <div className="scene-canvas" ref={containerRef} />
    </div>
  );
}
