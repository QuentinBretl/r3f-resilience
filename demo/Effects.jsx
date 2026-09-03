import { memo } from 'react';
import {
  Bloom,
  EffectComposer,
  Noise,
  SMAA,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode } from 'postprocessing';

/**
 * The post-processing chain.
 *
 * Memoised, and given props whose identity is stable, because an
 * EffectComposer rebuilds its pass list whenever the effect nodes change. On
 * the version pinned here that comparison is a real diff rather than an
 * identity check, so a re-render alone no longer costs anything — but the
 * habit is free and the diff is not guaranteed by any API contract.
 *
 * Note the order: bloom BEFORE tone mapping. Tone mapping compresses the image
 * into 0..1, and once it has, a cheek in full moonlight and a lamp are both
 * "about 0.9". Run bloom first and it reads the real values, where a lit
 * surface tops out near 1 while an emissive one sits at 4. That gap is where a
 * threshold can land.
 */
function EffectChain({ profile, aboveLit, toneMapping, smaa }) {
  return (
    // MSAA is dropped while SMAA is on, so that the two antialiasing paths are
    // compared one at a time and the error counter has a single cause.
    <EffectComposer multisampling={smaa ? 0 : profile.multisampling}>
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

      {/* The trap. SMAA is the ordinary, recommended way to antialias a chain
          and nothing about reaching for it looks risky, but it declares
          EffectAttribute.DEPTH and every effect carrying that attribute takes
          the composer down the same path: a "stable" depth target cloned from
          the input buffer's, sharing its Source, blitted onto itself once a
          frame. Turn it on and watch the GL error counter, not the edges. */}
      {smaa && <SMAA />}
    </EffectComposer>
  );
}

export default memo(EffectChain);
