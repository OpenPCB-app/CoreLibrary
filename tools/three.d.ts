// Minimal ambient types for the slice of `three` used by `glb-bounds.ts`.
// The installed `three` build ships no declarations and `@types/three` is not a
// dependency of this data-only repo; these cover exactly what the bounds helper
// touches so `tsc` stays green without pulling the full type package.

declare module "three" {
  export class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
  }
  export class Object3D {
    updateMatrixWorld(force?: boolean): void;
  }
  export class Group extends Object3D {}
  export class Box3 {
    min: Vector3;
    max: Vector3;
    setFromObject(object: Object3D): this;
    getSize(target: Vector3): Vector3;
    getCenter(target: Vector3): Vector3;
  }
}

declare module "three/examples/jsm/loaders/GLTFLoader.js" {
  import type { Group } from "three";
  export interface GLTF {
    scene: Group;
  }
  export class GLTFLoader {
    parse(
      data: ArrayBuffer,
      path: string,
      onLoad: (gltf: GLTF) => void,
      onError: (error: unknown) => void,
    ): void;
  }
}
