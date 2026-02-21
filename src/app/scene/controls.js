import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export function initControls(camera, renderer) {
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 2, 0);
  controls.update();
  controls.enabled = false;
  return controls;
}
