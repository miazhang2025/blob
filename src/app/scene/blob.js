import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

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

function createSoftVolume({
  Ammo,
  softBodyHelpers,
  physicsWorld,
  scene,
  bufferGeom,
  mass,
  pressure,
  material,
  damping,
  stiffness,
  margin,
}) {
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
  sbConfig.set_kDP(damping);
  sbConfig.set_kPR(pressure);
  volumeSoftBody.get_m_materials().at(0).set_m_kLST(stiffness);
  volumeSoftBody.get_m_materials().at(0).set_m_kAST(stiffness);
  volumeSoftBody.setTotalMass(mass, false);
  Ammo.castObject(volumeSoftBody, Ammo.btCollisionObject)
    .getCollisionShape()
    .setMargin(margin);
  physicsWorld.addSoftBody(volumeSoftBody, 1, -1);
  volume.userData.physicsBody = volumeSoftBody;
  volumeSoftBody.setActivationState(4);
  return volume;
}

async function loadModel(url) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  let foundGeometry = null;
  let foundMaterial = null;

  gltf.scene.traverse((child) => {
    if (!foundGeometry && child.isMesh && child.geometry) {
      foundGeometry = child.geometry.clone();
      if (child.material) {
        foundMaterial = child.material.clone();
        foundMaterial.flatShading = false;
      }
    }
  });

  // Merge duplicate vertices so computeVertexNormals produces smooth normals
  if (foundGeometry) {
    foundGeometry = BufferGeometryUtils.mergeVertices(foundGeometry);
    foundGeometry.computeVertexNormals();
  }

  return { geometry: foundGeometry, material: foundMaterial };
}

function normalizeGeometry(geometry, radius, anchorPosition) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = maxDim > 0 ? (radius * 2) / maxDim : 1;

  geometry.translate(-center.x, -center.y, -center.z);
  geometry.rotateY(- (Math.PI / 2));
  geometry.scale(scale, scale, scale);
  geometry.translate(anchorPosition.x, anchorPosition.y, anchorPosition.z);
  geometry.computeVertexNormals();
  return geometry;
}

export async function createBlobs({
  Ammo,
  softBodyHelpers,
  physicsWorld,
  scene,
  config,
  softBodies,
}) {
  const fallbackMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xff8b7a,
    roughness: 0.18,
    metalness: 0.18,
    clearcoat: 0.35,
  });

  let baseGeometry = null;
  let baseMaterial = null;
  if (config.modelUrl) {
    try {
      const model = await loadModel(config.modelUrl);
      baseGeometry = model.geometry;
      baseMaterial = model.material;
    } catch (error) {
      console.warn("Failed to load model, falling back to sphere.", error);
    }
  }

  if (!baseGeometry) {
    baseGeometry = new THREE.SphereGeometry(config.radius, 32, 24);
  }
  if (!baseMaterial) {
    baseMaterial = fallbackMaterial;
  }

  normalizeGeometry(baseGeometry, config.radius, config.anchorPosition);

  for (let i = 0; i < config.count; i += 1) {
    const geometry = baseGeometry.clone();
    const material = baseMaterial.clone();
    const volume = createSoftVolume({
      Ammo,
      softBodyHelpers,
      physicsWorld,
      scene,
      bufferGeom: geometry,
      mass: 50,
      pressure: config.softPressure,
      material,
      damping: config.softDamping,
      stiffness: config.softStiffness,
      margin: config.margin,
    });
    softBodies.push(volume);
  }
}

export function applyAnchorForces({ Ammo, softBodies, anchorPosition, anchorStrength }) {
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
      (anchorPosition.x - centerX) * anchorStrength,
      (anchorPosition.y - centerY) * anchorStrength,
      (anchorPosition.z - centerZ) * anchorStrength
    );
    softBody.addForce(anchorForce);
    Ammo.destroy(anchorForce);
  }
}

export function applyRestDamping({
  softBodies,
  anchorPosition,
  restSpeedThreshold,
  restDistanceThreshold,
  restPositionBlend,
  restVelocityLerp,
  isDragging,
}) {
  if (isDragging) return;

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
      centerX - anchorPosition.x,
      centerY - anchorPosition.y,
      centerZ - anchorPosition.z
    );

    if (speed > restSpeedThreshold || distance > restDistanceThreshold) {
      continue;
    }

    for (let j = 0; j < numNodes; j += 1) {
      const node = nodes.at(j);
      const nodePos = node.get_m_x();
      const nodeVel = node.get_m_v();
      nodeVel.setValue(
        nodeVel.x() * (1 - restVelocityLerp),
        nodeVel.y() * (1 - restVelocityLerp),
        nodeVel.z() * (1 - restVelocityLerp)
      );
      nodePos.setValue(
        nodePos.x() + (anchorPosition.x - centerX) * restPositionBlend,
        nodePos.y() + (anchorPosition.y - centerY) * restPositionBlend,
        nodePos.z() + (anchorPosition.z - centerZ) * restPositionBlend
      );
    }
  }
}

export function syncSoftBodies({ softBodies }) {
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
}
