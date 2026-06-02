import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ModelBounds {
  /** Axis-aligned bounding-box minimum corner, in the baked (scene Z-up, mm) frame. */
  min: Vec3;
  /** Axis-aligned bounding-box maximum corner. */
  max: Vec3;
  /** Extent (max - min) per axis. */
  size: Vec3;
  /** Geometric centre ((min + max) / 2). */
  center: Vec3;
}

/**
 * Parse a binary GLB and return the world-space AABB of all meshes, accounting
 * for the node transforms baked in during pack (the model-ref transform is
 * decomposed onto the wrapper node, so traversing world matrices is required).
 *
 * Runs in bun/node: GLB carries its buffers in the binary chunk, so GLTFLoader
 * needs no network/DOM. We only read geometry, never textures.
 */
export async function computeGlbBounds(
  glbBytes: Uint8Array,
): Promise<ModelBounds> {
  const loader = new GLTFLoader();
  const buffer = glbBytes.buffer.slice(
    glbBytes.byteOffset,
    glbBytes.byteOffset + glbBytes.byteLength,
  ) as ArrayBuffer;
  const scene = await new Promise<THREE.Group>((resolve, reject) => {
    loader.parse(
      buffer,
      "",
      (gltf) => resolve(gltf.scene),
      (error) =>
        reject(error instanceof Error ? error : new Error(String(error))),
    );
  });

  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) {
    throw new Error("GLB has no finite geometry bounds");
  }
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
    size: { x: size.x, y: size.y, z: size.z },
    center: { x: center.x, y: center.y, z: center.z },
  };
}

/** Round a vector to a fixed number of decimals (keeps committed bounds stable in diffs). */
export function roundVec3(v: Vec3, decimals = 4): Vec3 {
  const f = 10 ** decimals;
  return {
    x: Math.round(v.x * f) / f,
    y: Math.round(v.y * f) / f,
    z: Math.round(v.z * f) / f,
  };
}
