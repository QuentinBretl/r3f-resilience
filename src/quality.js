// Device-based quality tiers.
//
// Deliberately free of any `three` or `@react-three/fiber` import: you almost
// always need the tier *before* the Canvas exists, to decide what to mount at
// all. Importing the renderer here would force every consumer to resolve the
// tier inside the scene, which is exactly where it is least useful.

/**
 * Resolve a quality tier for the current device.
 *
 * @param {'auto'|'perf'|'high'} [quality='auto'] Explicit tier, or 'auto' to probe.
 * @returns {'perf'|'high'}
 */
export function resolveQualityTier(quality = 'auto') {
  if (quality === 'perf' || quality === 'high') return quality;

  // Server-side render: no navigator, and no GPU to protect either. Returning
  // the high tier keeps the markup identical to what a desktop client will
  // produce, so hydration does not tear.
  if (typeof window === 'undefined') return 'high';

  const ua = navigator.userAgent || '';

  // Two signals rather than one. The user-agent string catches phones that
  // advertise themselves honestly; `pointer: coarse` with more than one touch
  // point catches tablets and the desktop-mode browsers that lie about it.
  const isMobile =
    /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(ua) ||
    (navigator.maxTouchPoints > 1 &&
      typeof matchMedia === 'function' &&
      matchMedia('(pointer: coarse)').matches);

  // Both of these are absent on Safari and Firefox, hence the optimistic
  // fallback: an unknown machine is treated as capable, and the tier can still
  // be forced by the caller. Downgrading on missing data would punish every
  // Safari user for their browser's privacy stance.
  const lowCores = (navigator.hardwareConcurrency || 8) <= 4;
  const lowMemory = (navigator.deviceMemory || 8) <= 4;

  // Cores alone are a poor signal (an 8-core phone is still a phone), so the
  // desktop downgrade needs both to agree.
  return isMobile || (lowCores && lowMemory) ? 'perf' : 'high';
}

/**
 * Rendering budgets per tier.
 *
 * `shadows` is by far the heaviest line item and it is not close. A single
 * point light casting shadows renders the scene six times per frame, once per
 * cube-map face. Everything else in this table put together costs less than
 * turning that one flag on, which is why the perf tier drops it first and
 * keeps antialiasing.
 *
 * Spread these into your own object to add project-specific flags:
 *
 *   const profile = { ...QUALITY_PROFILES[tier], embers: tier === 'high' };
 */
export const QUALITY_PROFILES = {
  high: {
    // Range, not a number: react-three-fiber clamps the device pixel ratio
    // into it. [1, 2] means "supersample up to 2x on a 1x screen, never
    // render more than 2x on a retina one".
    dpr: [1, 2],
    // MSAA samples on the post-processing frame buffer, and zero on purpose.
    //
    // Multisampling makes the renderer resolve the buffer with
    // `blitFramebuffer`, and that resolve includes the depth attachment. Put a
    // selection-based effect in the same chain, one that re-renders the scene
    // into a buffer of its own, and the read and the write end up pointing at
    // the same depth image. WebGL rejects the blit, once per frame, forever:
    //
    //   GL_INVALID_OPERATION: glBlitFramebuffer: Read and write depth stencil
    //   attachments cannot be the same image.
    //
    // Nothing is drawn wrong, but the console floods and the tab can stop
    // responding. Raise this only in a chain with no such effect; otherwise
    // antialias through SMAA below, which needs no resolve at all.
    multisampling: 0,
    shadows: true,
    bloom: true,
    // A post pass that approximates antialiasing from the colour buffer.
    // Cheaper than MSAA, slightly softer, and it costs no framebuffer resolve.
    smaa: true,
    vignette: 0.45,
    grain: 0.05,
  },
  perf: {
    dpr: [1, 1.5],
    multisampling: 0,  // same reason as above, plus the cost
    shadows: false,
    bloom: false,
    smaa: true,
    vignette: 0.35,
    grain: 0,
  },
};

/**
 * Convenience wrapper: resolve the tier and hand back its profile.
 *
 * @param {'auto'|'perf'|'high'} [quality='auto']
 * @returns {typeof QUALITY_PROFILES.high}
 */
export function getQualityProfile(quality = 'auto') {
  return QUALITY_PROFILES[resolveQualityTier(quality)];
}
