"use client";

import { useEffect, useRef } from "react";
import { initBlobScene } from "./scene/blobScene";

export default function Home() {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const cleanup = initBlobScene(containerRef.current);
    return () => {
      if (cleanup) cleanup();
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
