import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useStore, useThree } from '@react-three/fiber';
import { countPrograms, useSelectionLayer } from 'r3f-resilience';

// Layer 0 is where every object already lives. Anything from 1 to 31 is free.
export const BLOOM_LAYER = 11;

const LAMP_COLOURS = ['#ffb02e', '#4dd4ff', '#ff5470'];

/**
 * Three orbiting emissive spheres. They are the only objects that should ever
 * bloom, and the demo lets you check that claim both ways.
 */
function Lamps({ selective }) {
  const group = useRef(null);
  // A state ref rather than a plain one: useSelectionLayer needs to re-run
  // when the object actually exists, and a ref mutation does not re-render.
  const [root, setRoot] = useState(null);

  useSelectionLayer(root, BLOOM_LAYER, selective);

  useFrame(({ clock }) => {
    if (group.current) group.current.rotation.y = clock.elapsedTime * 0.35;
  });

  return (
    <group
      ref={(node) => {
        group.current = node;
        setRoot(node);
      }}
    >
      {LAMP_COLOURS.map((colour, index) => {
        const angle = (index / LAMP_COLOURS.length) * Math.PI * 2;
        return (
          <mesh
            key={colour}
            position={[Math.cos(angle) * 2.6, 1.1, Math.sin(angle) * 2.6]}
          >
            <sphereGeometry args={[0.28, 32, 32]} />
            {/* Emissive well above 1 so it clears the bloom threshold while
                the lit surfaces below stay under it. That gap is what makes
                selective bloom look deliberate instead of hazy. */}
            <meshStandardMaterial
              color="#0a0a10"
              emissive={colour}
              emissiveIntensity={4}
              roughness={0.4}
            />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * A lit, shadow-casting object. Bright under the key light, and deliberately
 * pale: it is the surface that a non-selective bloom will smear.
 */
function Centrepiece() {
  const mesh = useRef(null);

  useFrame((_, delta) => {
    if (!mesh.current) return;
    mesh.current.rotation.x += delta * 0.15;
    mesh.current.rotation.y += delta * 0.22;
  });

  return (
    <mesh ref={mesh} position={[0, 1.15, 0]} castShadow receiveShadow>
      <torusKnotGeometry args={[0.75, 0.24, 160, 24]} />
      <meshStandardMaterial color="#e8e4d9" roughness={0.45} metalness={0.15} />
    </mesh>
  );
}

/**
 * Samples the renderer every 250 ms and reports upward.
 *
 * Program count is the number to watch: it settles once the scene has warmed
 * up, then stays flat. If it climbs while nothing changes on screen, something
 * is being rebuilt every render and the context is on a timer.
 */
function Readout({ onSample }) {
  const gl = useThree((state) => state.gl);
  const store = useStore();

  // Debug hatch, armed only by ?gl= in the URL. Hands the r3f store to the
  // console so a frame can be forced by hand: an automated browser throttles
  // requestAnimationFrame in an unfocused window, and a scene that never
  // renders cannot be measured.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('gl')) {
      window.__r3f = store;
    }
  }, [store]);

  const last = useRef(0);
  const frames = useRef(0);
  const since = useRef(0);

  useFrame((_, delta) => {
    frames.current += 1;
    since.current += delta;
    if (since.current < 0.25) return;

    const now = performance.now();
    onSample({
      programs: countPrograms(gl),
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      calls: gl.info.render.calls,
      fps: Math.round(frames.current / since.current),
      pixelRatio: Number(gl.getPixelRatio().toFixed(2)),
    });

    last.current = now;
    frames.current = 0;
    since.current = 0;
  });

  return null;
}

export default function Scene({ profile, selective, onSample }) {
  // Geometry-free: nothing is loaded from disk, so the repository stays a few
  // kilobytes and the demo boots instantly on a cold cache.
  const ground = useMemo(() => [14, 14], []);

  return (
    <>
      <color attach="background" args={['#0a0c14']} />
      <fog attach="fog" args={['#0a0c14', 9, 22]} />

      <ambientLight intensity={0.25} color="#39406b" />
      <directionalLight
        position={[4, 7, 5]}
        intensity={2.4}
        color="#fff4e0"
        castShadow={profile.shadows}
        shadow-mapSize={[1024, 1024]}
      />

      <Centrepiece />
      <Lamps selective={selective} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={ground} />
        <meshStandardMaterial color="#141824" roughness={0.9} />
      </mesh>

      <Readout onSample={onSample} />
    </>
  );
}
