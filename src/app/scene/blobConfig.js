import * as THREE from "three";

export const BLOB_CONFIG = {
  count: 1,
  radius: 2,
  gravity: 0,
  margin: 0.01,
  anchorPosition: new THREE.Vector3(0, 3, 0),
  anchorStrength: 20,
  dragStrength: 5,
  dragDistanceScale: 200,
  softPressure: 3000,
  softDamping: 0.01,
  softStiffness: 0.08,
  restSpeedThreshold: 1.5,
  restDistanceThreshold: 2,
  restPositionBlend: 0.25,
  restVelocityLerp: 0.35,
};
