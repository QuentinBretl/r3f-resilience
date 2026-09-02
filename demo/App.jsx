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
import EffectsHost from './Effects.jsx';
import Panel from './Panel.jsx';

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
  const [selective, setSelective] = useState(true);
  const [toneMapping, setToneMapping] = useState(true);
  const [churn, setChurn] = useState(false);
  const [memoise, setMemoise] = useState(true);
  const [stats, setStats] = useState(null);

  const rendererRef = useRef(null);

  const { onCreated: attachContextLoss, lost } = useWebGLContextLoss();

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
          frameloop={lost ? 'never' : 'always'}
          gl={GL}
          shadows={profile.shadows}
          style={CANVAS_STYLE}
          onCreated={handleCreated}
        >
          <Scene profile={profile} selective={selective} onSample={onSample} />
          <EffectsHost
            profile={profile}
            selective={selective}
            toneMapping={toneMapping}
            churn={churn}
            memoise={memoise}
          />
        </Canvas>

        {lost && (
          <div className="lost">
            <h2>The WebGL context is gone.</h2>
            <p>
              Nothing threw. No error boundary fired. The canvas simply stopped
              painting, which is exactly how this failure reaches your users.
            </p>
            <button
              type="button"
              onClick={() => restoreContext(rendererRef.current)}
            >
              Restore the context
            </button>
          </div>
        )}
      </div>

      <Panel
        tier={tier}
        resolved={resolved}
        profile={profile}
        stats={stats}
        selective={selective}
        toneMapping={toneMapping}
        churn={churn}
        memoise={memoise}
        onTier={setTier}
        onSelective={setSelective}
        onToneMapping={setToneMapping}
        onChurn={setChurn}
        onMemoise={setMemoise}
        onKill={() => {
          if (!loseContext(rendererRef.current)) {
            // WEBGL_lose_context is optional. Say so rather than leaving the
            // button looking broken.
            window.alert(
              'WEBGL_lose_context is unavailable in this browser, so the loss cannot be simulated here.',
            );
          }
        }}
      />
    </div>
  );
}
