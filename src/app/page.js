"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { initBlobScene } from "./scene/blobScene";

export default function Home() {
  const containerRef = useRef(null);
  const cleanupRef = useRef(null);
  const [key, setKey] = useState(0);

  const startScene = useCallback(() => {
    if (!containerRef.current) return;
    if (cleanupRef.current) cleanupRef.current();
    cleanupRef.current = initBlobScene(containerRef.current);
  }, []);

  useEffect(() => {
    startScene();
    return () => {
      if (cleanupRef.current) cleanupRef.current();
    };
  }, [key, startScene]);

  const handleReload = () => {
    if (containerRef.current) containerRef.current.innerHTML = "";
    setKey((k) => k + 1);
  };

  return (
    <div className="scene-root">
      <div className="scene-ui">
        <div className="scene-note">
          DRAG ME CRAZY. Drag to stretch and release.
        </div>
        <button className="scene-button" onClick={handleReload}>
          reload
        </button>
      </div>
      <div className="scene-canvas" ref={containerRef} />
    </div>
  );
}
