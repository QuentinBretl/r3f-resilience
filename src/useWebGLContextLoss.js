import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Detect and survive WebGL context loss.
 *
 * A lost context is not an exception. Nothing throws, no error boundary fires,
 * `useFrame` keeps being called. The canvas simply stops painting and goes
 * black, and your users report "the 3D is broken" while your logs stay clean.
 * It happens for reasons entirely outside your control: a driver reset, a
 * laptop switching GPUs, a background tab reclaimed by the browser, or one
 * WebGL context too many on the page (browsers cap it around sixteen and drop
 * the oldest without asking).
 *
 * Two details carry this hook, and both are easy to get wrong.
 *
 * 1. `event.preventDefault()` on `webglcontextlost` is mandatory. Without it
 *    the browser never fires `webglcontextrestored`, and the loss is final.
 *    The default action of that event is, counter-intuitively, "give up".
 *
 * 2. The listeners have to be detached on unmount. react-three-fiber calls
 *    `gl.forceContextLoss()` itself when a Canvas unmounts, to hand the
 *    context back to the GPU. That fires a perfectly normal
 *    `webglcontextlost`. Leave the listener attached and every ordinary route
 *    change is reported to your users as a crash.
 *
 * @param {object} [options]
 * @param {(event: Event) => void} [options.onLost]
 * @param {(event: Event) => void} [options.onRestored]
 * @returns {{ onCreated: (state: { gl: import('three').WebGLRenderer }) => void, lost: boolean }}
 *
 * @example
 * const { onCreated, lost } = useWebGLContextLoss();
 * return lost
 *   ? <SceneUnavailable />
 *   : <Canvas onCreated={onCreated}>{children}</Canvas>;
 */
export function useWebGLContextLoss({ onLost, onRestored } = {}) {
  const [lost, setLost] = useState(false);

  // The callbacks live in a ref so that passing a fresh arrow function on
  // every render does not change `onCreated`. Its identity matters: r3f keeps
  // the callback it was handed on its last configuration pass.
  const callbacks = useRef({ onLost, onRestored });
  callbacks.current = { onLost, onRestored };

  const detach = useRef(null);

  useEffect(
    () => () => {
      detach.current?.();
      detach.current = null;
    },
    [],
  );

  const onCreated = useCallback((state) => {
    const canvas = state.gl.domElement;

    const handleLost = (event) => {
      event.preventDefault();
      setLost(true);
      callbacks.current.onLost?.(event);
    };

    const handleRestored = (event) => {
      setLost(false);
      callbacks.current.onRestored?.(event);
    };

    canvas.addEventListener('webglcontextlost', handleLost);
    canvas.addEventListener('webglcontextrestored', handleRestored);

    detach.current = () => {
      canvas.removeEventListener('webglcontextlost', handleLost);
      canvas.removeEventListener('webglcontextrestored', handleRestored);
    };
  }, []);

  return { onCreated, lost };
}
