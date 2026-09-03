import { memo, useEffect, useReducer, useState } from 'react';
import { useThree } from '@react-three/fiber';
import {
  Bloom,
  EffectComposer,
  Noise,
  SMAA,
  SelectiveBloom,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode } from 'postprocessing';
import { BLOOM_LAYER } from './Scene.jsx';

// The lights of the scene, collected once they are attached.
//
// SelectiveBloom needs them, and the reason is worth knowing: to isolate the
// selection it re-renders it into a buffer of its own, and a light only
// illuminates an object when the two share a layer. Handing the lights over is
// how the library enables the selection layer on them, so the selected objects
// come out lit rather than as black silhouettes. Omit them and the library
// warns; the effect still runs, but only emissive materials contribute.
//
// An effect and not a render-time traversal: r3f attaches objects to the scene
// during commit, so at render time the lights are not there yet.
const NO_LIGHTS = [];

function useSceneLights() {
  const scene = useThree((state) => state.scene);
  const [lights, setLights] = useState(NO_LIGHTS);

  useEffect(() => {
    const found = [];
    scene.traverse((object) => {
      if (object.isLight) found.push(object);
    });
    setLights(found.length ? found : NO_LIGHTS);
  }, [scene]);

  return lights;
}

/**
 * The chain itself.
 *
 * Note the order: bloom BEFORE tone mapping. Tone mapping compresses the image
 * into 0..1, and once it has, a cheek in full moonlight and a lamp are both
 * "about 0.9". Run bloom first and it reads the real values, where a lit
 * surface tops out near 1 while an emissive one sits at 4. The threshold then
 * has somewhere to land.
 */
function EffectChain({ profile, selective, toneMapping }) {
  const lights = useSceneLights();

  return (
    <EffectComposer multisampling={profile.multisampling}>
      {profile.bloom &&
        (selective ? (
          <SelectiveBloom
            selectionLayer={BLOOM_LAYER}
            lights={lights}
            intensity={2.4}
            luminanceThreshold={0.6}
            luminanceSmoothing={0.3}
            radius={0.8}
            mipmapBlur
          />
        ) : (
          <Bloom
            intensity={2.4}
            luminanceThreshold={0.6}
            luminanceSmoothing={0.3}
            radius={0.8}
            mipmapBlur
          />
        ))}

      {/* Without this pass the composer leaves the renderer on NoToneMapping
          and the image comes out flat: raised blacks, colours that never
          resolve. It is not a stylistic extra, it is the curve you had before
          you added post-processing at all. */}
      {toneMapping && <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />}

      <Vignette offset={0.3} darkness={profile.vignette} />
      {profile.grain > 0 && (
        <Noise
          premultiply
          blendFunction={BlendFunction.OVERLAY}
          opacity={profile.grain}
        />
      )}
      {profile.smaa && <SMAA />}
    </EffectComposer>
  );
}

const MemoisedChain = memo(EffectChain);

/** Re-render on a timer, to stand in for a parent that updates constantly. */
function useChurn(active, hz = 30) {
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(bump, 1000 / hz);
    return () => clearInterval(id);
  }, [active, hz]);
}

/**
 * Hosts the chain.
 *
 * An EffectComposer rebuilds its pass list whenever `children` changes
 * identity, which in React means on every render of whatever holds the JSX. So
 * a composer written inline inside a component that re-renders often, and
 * "often" here means any component subscribed to a context that updates on
 * every incoming message, tears its passes down and builds them again several
 * times a second.
 *
 * The received wisdom is that this leaks GPU memory, because `removePass` was
 * historically not paired with a dispose. On the version pinned here,
 * @react-three/postprocessing 3.0.4, that is no longer true: the teardown
 * effect calls `removePass` and `disposeGeneratedPass` together. Measured over
 * this demo, with the chain rebuilt thirty times a second, the shader program
 * and texture counts stay flat.
 *
 * Which is the reason the counters are on screen. The advice below survives
 * the correction, but for its real reason rather than a borrowed one: you are
 * still rebuilding passes and recompiling shaders at 30 Hz for nothing, and
 * that is CPU time and frame-pacing, not a fuse on the context. Turn the
 * switches on and watch the numbers yourself rather than taking either claim
 * on trust.
 *
 * The fix is boring, which is rather the point: hoist the chain into a
 * component of its own, memoise it, and give it props whose identity is
 * stable.
 */
export default function EffectsHost({
  profile,
  selective,
  toneMapping,
  churn,
  memoise,
}) {
  useChurn(churn);

  return memoise ? (
    <MemoisedChain
      profile={profile}
      selective={selective}
      toneMapping={toneMapping}
    />
  ) : (
    <EffectChain
      profile={profile}
      selective={selective}
      toneMapping={toneMapping}
    />
  );
}
