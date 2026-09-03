import { memo, useEffect, useReducer } from 'react';
import {
  Bloom,
  EffectComposer,
  Noise,
  SMAA,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode } from 'postprocessing';

// No SelectiveBloom here, and that is a finding rather than a preference.
//
// On postprocessing 6.39.4 it declares EffectAttribute.DEPTH, which makes the
// composer build a "stable" depth target by CLONING the input buffer's depth
// texture. A cloned three.js texture shares its Source, so both map to the
// same GPU image, and the composer then blits that image onto itself once per
// frame. WebGL refuses, the console floods, and the tab stops responding. The
// README walks the whole trace.
//
// The same visual point is made below with a threshold placed in the gap
// between what is lit and what emits, which is the more useful lesson anyway.

/**
 * The chain itself.
 *
 * Note the order: bloom BEFORE tone mapping. Tone mapping compresses the image
 * into 0..1, and once it has, a cheek in full moonlight and a lamp are both
 * "about 0.9". Run bloom first and it reads the real values, where a lit
 * surface tops out near 1 while an emissive one sits at 4. That gap is where a
 * threshold can land.
 */
function EffectChain({ profile, aboveLit, toneMapping }) {
  return (
    <EffectComposer multisampling={profile.multisampling}>
      {profile.bloom && (
        <Bloom
          intensity={2.4}
          // 2.2 sits above every lit surface and below the dimmest of the
          // three lamps, so only what emits glows. 0.15 sits under both, which
          // is the naive setting: the pale centrepiece, merely lit, smears
          // like a lamp.
          luminanceThreshold={aboveLit ? 2.2 : 0.15}
          luminanceSmoothing={0.3}
          radius={0.8}
          mipmapBlur
        />
      )}

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
 * historically not paired with a dispose. On the version pinned here that is
 * no longer true: the teardown effect calls `removePass` and
 * `disposeGeneratedPass` together. Measured over this demo, with the chain
 * rebuilt thirty times a second, the shader program and texture counts stay
 * flat.
 *
 * Which is the reason the counters are on screen. The advice survives the
 * correction, but for its real reason rather than a borrowed one: you are
 * still rebuilding passes and recompiling shaders at 30 Hz for nothing, and
 * that is CPU time and frame pacing, not a fuse on the context. Turn the
 * switches on and watch the numbers yourself rather than taking either claim
 * on trust.
 */
export default function EffectsHost({
  profile,
  aboveLit,
  toneMapping,
  churn,
  memoise,
}) {
  useChurn(churn);

  return memoise ? (
    <MemoisedChain
      profile={profile}
      aboveLit={aboveLit}
      toneMapping={toneMapping}
    />
  ) : (
    <EffectChain
      profile={profile}
      aboveLit={aboveLit}
      toneMapping={toneMapping}
    />
  );
}
