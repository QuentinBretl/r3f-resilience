import { useCallback, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  QUALITY_PROFILES,
  loseContext,
  resolveQualityTier,
  restoreContext,
  useWebGLContextLoss,
} from 'r3f-resilience';
import Scene from './Scene.jsx';
import EffectChain from './Effects.jsx';
import Panel from './Panel.jsx';
import { resetGLProbe } from './glProbe.js';

// Frozen at module scope, and this is not tidiness.
//
// react-three-fiber's configuration effect has no dependency array: it replays
// on every render of the component holding the Canvas. Object literals written
// inline are a new object each time, so the renderer is reconfigured for
// nothing, several times a second, forever. Hoisting costs one line and the
// churn disappears.
const CAMERA = { position: [0, 2.6, 7], fov: 45, near: 0.1, far: 100 };
const GL = { antialias: true };
const CANVAS_STYLE = { position: 'absolute', inset: 0 };

export default function App() {
  const [tier, setTier] = useState('auto');

  // The three switches below turn OFF a piece of production code, one at a
  // time. Every one of them is unchecked by default, so the demo starts in the
  // state you would ship and each click removes something real.
  const [detectLoss, setDetectLoss] = useState(true);
  const [rebuildChain, setRebuildChain] = useState(false);
  const [smaa, setSmaa] = useState(false);

  const [toneMapping, setToneMapping] = useState(true);
  const [aboveLit, setAboveLit] = useState(true);

  const [stats, setStats] = useState(null);
  const [restoreAttempts, setRestoreAttempts] = useState(0);
  const [unsupported, setUnsupported] = useState(false);

  // Bumped on every restore and used as the effect chain's `key`.
  //
  // Restoring the context brings the scene back but not what the chain had
  // allocated: its render targets belonged to the context that went away.
  // Changing the key unmounts it and builds it again from nothing.
  const [generation, setGeneration] = useState(0);


  const rendererRef = useRef(null);

  // Read inside the restore callback, which is created once.
  const rebuildChainRef = useRef(rebuildChain);
  rebuildChainRef.current = rebuildChain;

  const { onCreated: attachContextLoss, lost } = useWebGLContextLoss({
    // Only bumped when the switch asks for the rebuild. Making the key depend
    // on the switch directly would remount the chain the moment you flick it,
    // which is a different event from the one being tested.
    onRestored: () => setGeneration((n) => (rebuildChainRef.current ? n + 1 : n)),
  });

  // One stable callback for both jobs: r3f keeps whichever it was handed on
  // its last configuration pass, so this must not be recreated per render.
  const handleCreated = useCallback(
    (state) => {
      rendererRef.current = state.gl;
      attachContextLoss(state);
    },
    [attachContextLoss],
  );

  const resolved = resolveQualityTier(tier);
  const profile = QUALITY_PROFILES[resolved];

  const onSample = useCallback((sample) => setStats(sample), []);

  const handleKill = () => {
    setRestoreAttempts(0);
    // WEBGL_lose_context is optional, and the renderer may not exist yet.
    // Report that in the panel rather than through window.alert: a modal
    // dialog blocks the event loop, which on a page whose whole subject is a
    // frozen tab is a poor way to say anything.
    setUnsupported(!loseContext(rendererRef.current));
  };

  const handleRestore = () => {
    setRestoreAttempts((n) => n + 1);
    restoreContext(rendererRef.current);
  };

  // Get back to a working scene from any state the switches can leave it in:
  // a context that is still lost, or a composer that was rebuilt at the wrong
  // moment and now fails its resolve every frame.
  //
  // Note what this does NOT do: remount the Canvas. Tearing one down makes r3f
  // call `forceContextLoss()`, three.js then asks for `WEBGL_lose_context` to
  // carry it out, and on a context that is still lost `getExtension()` returns
  // null and three.js warns. Restoring the context and rebuilding the chain
  // reaches the same place without spending a line of console on it.
  const handleReset = () => {
    setRestoreAttempts(0);
    if (lost) restoreContext(rendererRef.current);
    setGeneration((n) => n + 1);
  };

  const handleSmaa = (next) => {
    // The counter measures the mode you are in, not the history of the page.
    resetGLProbe();
    setSmaa(next);
  };

  // What the application is allowed to know. With detection off the scene is
  // just as dead, and nothing on the page says so: no notice, and the render
  // loop keeps running at full speed into a context that ignores every draw
  // call. That is what your users get, and why they report a slow page rather
  // than a broken one.
  const knowsItIsLost = lost && detectLoss;

  return (
    <div className="app">
      <div className="stage">
        {/* The Canvas stays mounted while the context is lost, and the notice
            is laid over it.

            Unmounting it was my first instinct and it is wrong: tear the
            canvas down and you destroy the only object that can ever receive
            `webglcontextrestored`, so the scene can never come back on its
            own. Keep it, cover it, and a restored context simply resumes
            painting under a notice you then remove.

            `frameloop` goes to "never" meanwhile. A lost context still accepts
            draw calls, it just ignores them, and r3f would keep rendering into
            the void several hundred times a second while the user reads the
            message. */}
        <Canvas
          camera={CAMERA}
          dpr={profile.dpr}
          frameloop={knowsItIsLost ? 'never' : 'always'}
          gl={GL}
          shadows={profile.shadows}
          style={CANVAS_STYLE}
          onCreated={handleCreated}
        >
          <Scene profile={profile} onSample={onSample} />
          {/* Left mounted through a loss and never re-keyed, which measurement
              says is both sufficient and cheaper. The switch opts into the
              usual advice instead - rebuild the chain once the context is
              back - and that turns out to be the destructive option: the old
              composer is disposed after the restore, so three.js deletes GPU
              objects belonging to the generation that died, against a context
              that has since been revived. */}
          {(
            <EffectChain
              key={generation}
              profile={profile}
              aboveLit={aboveLit}
              toneMapping={toneMapping}
              smaa={smaa}
            />
          )}
        </Canvas>

        {knowsItIsLost && (
          <div className="lost">
            <h2>The WebGL context is gone.</h2>
            <p>
              Nothing threw. No error boundary fired. The canvas simply stopped
              painting, which is exactly how this failure reaches your users.
            </p>

            <button type="button" onClick={handleRestore}>
              Restore the context
            </button>

            <p className="note">
              Restoring works because the Canvas is still mounted underneath
              this notice. Replace it with a fallback instead of covering it and
              you throw away the object the browser restores into — React will
              mount you a new one, at the cost of a fresh context and every
              shader recompiled.
            </p>
          </div>
        )}
      </div>

      <Panel
        tier={tier}
        resolved={resolved}
        profile={profile}
        stats={stats}
        unsupported={unsupported}
        detectLoss={detectLoss}
        rebuildChain={rebuildChain}
        smaa={smaa}
        toneMapping={toneMapping}
        aboveLit={aboveLit}
        lost={lost}
        blind={lost && !detectLoss}
        onTier={setTier}
        onDetectLoss={setDetectLoss}
        onRebuildChain={setRebuildChain}
        onSmaa={handleSmaa}
        onToneMapping={setToneMapping}
        onAboveLit={setAboveLit}
        onKill={handleKill}
        onRestore={handleRestore}
        onReset={handleReset}
      />
    </div>
  );
}
