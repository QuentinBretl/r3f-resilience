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
 * You do NOT need to call `event.preventDefault()` yourself here, which is the
 * opposite of the advice you will find everywhere. three.js attaches its own
 * `webglcontextlost` listener when the renderer is constructed and calls
 * `preventDefault()` inside it (`WebGLRenderer`, `onContextLost`). The advice
 * is sound for a hand-rolled canvas and redundant for every three.js app.
 *
 * What the renderer does not do is tell your application. It logs a line to
 * the console, sets an internal flag and stops painting. React hears nothing,
 * so a scene that has quietly died looks exactly like a scene that is dark.
 * That is what this hook is for.
 *
 * Two details carry it, and both are easy to get wrong.
 *
 * 1. The listeners have to be detached, both on unmount and before attaching
 *    to a new canvas. react-three-fiber calls `gl.forceContextLoss()` itself
 *    when a Canvas unmounts, to hand the context back to the GPU. That fires a
 *    perfectly normal `webglcontextlost`. Leave the listener attached and
 *    every ordinary route change is reported to your users as a crash.
 *
 * 2. `lost` has to be resettable, because the way out of a loss you cannot
 *    undo is to throw the canvas away and mount a new one, and the hook must
 *    not carry the old canvas's verdict onto the new context.
 *
 * @param {object} [options]
 * @param {(event: Event) => void} [options.onLost]
 * @param {(event: Event) => void} [options.onRestored]
 * @returns {{ onCreated: (state: { gl: import('three').WebGLRenderer }) => void, lost: boolean, reset: () => void }}
 *
 * @example
 * const { onCreated, lost } = useWebGLContextLoss();
 * return (
 *   <div style={{ position: 'relative' }}>
 *     <Canvas frameloop={lost ? 'never' : 'always'} onCreated={onCreated} />
 *     {lost && <SceneUnavailable />}
 *   </div>
 * );
 */
export function useWebGLContextLoss({ onLost, onRestored } = {}) {
  const [lost, setLost] = useState(false);

  // The callbacks live in a ref so that passing fresh arrow functions on every
  // render does not change `onCreated`. Its identity matters: r3f keeps the
  // callback it was handed on its last configuration pass.
  const options = useRef({ onLost, onRestored });
  options.current = { onLost, onRestored };

  const detach = useRef(null);

  useEffect(
    () => () => {
      detach.current?.();
      detach.current = null;
    },
    [],
  );

  const onCreated = useCallback((state) => {
    // A Canvas can be remounted, and then this runs again. Drop the previous
    // canvas's listeners first: r3f loses that context on the way out, and an
    // orphaned listener would report the teardown as a fresh crash.
    detach.current?.();

    const canvas = state.gl.domElement;

    const handleLost = (event) => {
      setLost(true);
      options.current.onLost?.(event);
    };

    const handleRestored = (event) => {
      setLost(false);
      options.current.onRestored?.(event);
    };

    canvas.addEventListener('webglcontextlost', handleLost);
    canvas.addEventListener('webglcontextrestored', handleRestored);

    detach.current = () => {
      canvas.removeEventListener('webglcontextlost', handleLost);
      canvas.removeEventListener('webglcontextrestored', handleRestored);
    };
  }, []);

  const reset = useCallback(() => setLost(false), []);

  return { onCreated, lost, reset };
}
