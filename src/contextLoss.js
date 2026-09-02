// The extension object, kept per context.
//
// This cache is not an optimisation, it is the only thing that makes restoring
// possible. `getExtension()` returns null while a context is lost, by
// specification, so asking for WEBGL_lose_context at the moment you want to
// restore always hands you nothing. The object has to be captured while the
// context is still alive, and it stays usable across the loss.
const extensions = new WeakMap();

function loseContextExtension(renderer, { cachedOnly = false } = {}) {
  const gl = renderer?.getContext?.();
  if (!gl) return null;

  const cached = extensions.get(gl);
  if (cached || cachedOnly) return cached ?? null;

  const extension = gl.getExtension('WEBGL_lose_context');
  if (extension) extensions.set(gl, extension);
  return extension;
}

/**
 * Force a context loss, on purpose.
 *
 * Recovery code that has never been exercised is decoration. `WEBGL_lose_context`
 * is the only honest way to test it: it puts the context through exactly the
 * transition a driver reset would, listeners and all. Use it in a dev-only
 * panel or an end-to-end test.
 *
 * The extension is optional and a browser may refuse it, so the return value
 * says whether anything actually happened. Do not assume it did.
 *
 * @param {import('three').WebGLRenderer} renderer
 * @returns {boolean} true when the loss was triggered
 */
export function loseContext(renderer) {
  const extension = loseContextExtension(renderer);
  if (!extension) return false;
  extension.loseContext();
  return true;
}

/**
 * Restore a context previously dropped with {@link loseContext}.
 *
 * Only works for a simulated loss, and only when {@link loseContext} captured
 * the extension first, for the reason given above. A real loss is restored by
 * the browser on its own schedule and calling this will not hurry it along.
 *
 * Note that restoring is not the end of the story: every GPU resource created
 * before the loss is gone. three.js re-uploads what it still holds references
 * to, but anything you cached by hand, render targets above all, has to be
 * rebuilt. Restoration is a starting point, not a fix.
 *
 * @param {import('three').WebGLRenderer} renderer
 * @returns {boolean}
 */
export function restoreContext(renderer) {
  const extension = loseContextExtension(renderer, { cachedOnly: true });
  if (!extension) return false;
  extension.restoreContext();
  return true;
}

/**
 * Count the shader programs currently held by the renderer.
 *
 * The single most useful number when hunting a GPU leak. It should settle
 * after the scene warms up and then stay flat. If it climbs while nothing
 * visible changes, something is recreating materials or post-processing
 * passes every render, and the context will eventually be dropped.
 *
 * @param {import('three').WebGLRenderer} renderer
 * @returns {number}
 */
export function countPrograms(renderer) {
  return renderer?.info?.programs?.length ?? 0;
}
