import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF, Center, Bounds } from "@react-three/drei";

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

export function Model3DViewer({
  url,
  size = 320,
}: {
  url: string;
  size?: number;
}) {
  return (
    <div
      style={{ width: size, height: size, background: "#0a0a0a" }}
      className="rounded-md"
    >
      <Canvas camera={{ position: [0, 0, 30], fov: 35 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[5, 5, 5]} intensity={1} />
        <directionalLight position={[-5, -3, -5]} intensity={0.4} />
        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1.4}>
            <Center>
              <Model url={url} />
            </Center>
          </Bounds>
        </Suspense>
        <OrbitControls enableDamping />
      </Canvas>
    </div>
  );
}
