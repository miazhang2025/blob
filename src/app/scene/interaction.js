import * as THREE from "three";

export function createDragController({
  Ammo,
  camera,
  renderer,
  softBodies,
  anchorPosition,
  dragDistanceScale,
  dragStrength,
}) {
  const raycaster = new THREE.Raycaster();
  const dragState = {
    active: false,
    index: -1,
    nodeIndex: -1,
    plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
    target: new THREE.Vector3(),
  };
  const dragOffset = new THREE.Vector3();

  function updateDragTarget(event) {
    if (!raycaster || !camera || !renderer) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);
    raycaster.ray.intersectPlane(dragState.plane, dragState.target);
    dragState.target.z = anchorPosition.z;
    dragOffset
      .copy(dragState.target)
      .sub(anchorPosition)
      .multiplyScalar(dragDistanceScale);
    dragState.target.copy(anchorPosition).add(dragOffset);
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
      dragState.plane.constant = -anchorPosition.z;
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
        (dragState.target.x - nodePos.x()) * dragStrength,
        (dragState.target.y - nodePos.y()) * dragStrength,
        (dragState.target.z - nodePos.z()) * dragStrength
      );
      softBody.addForce(force, dragState.nodeIndex);
      Ammo.destroy(force);
    }
  }

  return {
    applyDragForce,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    isDragging: () => dragState.active,
  };
}
