function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        <em>{hint}</em>
      </span>
    </label>
  );
}

function Stat({ label, value, alarm }) {
  return (
    <div className={alarm ? 'alarm' : undefined}>
      <dt>{label}</dt>
      <dd>{value ?? '—'}</dd>
    </div>
  );
}

export default function Panel({
  tier,
  resolved,
  profile,
  stats,
  unsupported,
  detectLoss,
  blind,
  rebuildChain,
  smaa,
  toneMapping,
  aboveLit,
  lost,
  onTier,
  onDetectLoss,
  onRestore,
  onReset,
  onRebuildChain,
  onSmaa,
  onToneMapping,
  onAboveLit,
  onKill,
}) {
  return (
    <aside className="panel">
      <header>
        <h1>r3f-resilience</h1>
        <p>
          One WebGL failure that nothing in JavaScript can see, one that floods
          the driver until the tab gives up, and four widely repeated fixes -
          three of which do not survive being measured. Every claim here is a
          number you can watch move.
        </p>
      </header>

      <section>
        <h2>Quality tier</h2>
        <div className="tiers">
          {['auto', 'perf', 'high'].map((value) => (
            <button
              key={value}
              type="button"
              className={tier === value ? 'active' : undefined}
              onClick={() => onTier(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <p className="note">
          Resolved to <code>{resolved}</code> from the user agent, core count
          and device memory. Shadows are the first thing dropped, because a
          single shadow-casting point light renders the scene six times per
          frame.
        </p>
        <dl className="grid">
          <Stat label="dpr range" value={profile.dpr.join(' – ')} />
          <Stat
            label="antialiasing"
            value={
              smaa
                ? 'SMAA'
                : profile.multisampling
                  ? `MSAA ${profile.multisampling}`
                  : 'none'
            }
          />
          <Stat label="shadows" value={profile.shadows ? 'on' : 'off'} />
          <Stat label="bloom" value={profile.bloom ? 'on' : 'off'} />
        </dl>
      </section>

      <section>
        <h2>Live</h2>
        <dl className="grid">
          <Stat label="fps" value={stats?.fps} />
          <Stat label="pixel ratio" value={stats?.pixelRatio} />
          <Stat label="shader programs" value={stats?.programs} />
          <Stat label="textures" value={stats?.textures} />
          <Stat label="geometries" value={stats?.geometries} />
          <Stat label="gl errors" value={stats?.glErrors} alarm={stats?.glErrors > 0} />
        </dl>
        {stats?.glErrors > 0 && (
          <p className="warn">
            The driver is refusing calls right now. If you did not turn SMAA on
            below, the scene is in a state it will not leave on its own —{' '}
            <button type="button" className="inline" onClick={onReset}>
              rebuild the scene
            </button>
            .
          </p>
        )}
        <p className="note">
          Programs and textures settle after warm-up and then stay flat; a
          number that climbs while nothing changes on screen is a GPU leak.
          <strong> gl errors</strong> counts failures the browser reports to
          nobody: they are printed to the console and never raised through
          JavaScript, so this counter is the only thing on the page that can
          see them. It is measured by wrapping <code>blitFramebuffer</code> and
          reading the GL error queue right after each call.
        </p>
      </section>

      <section>
        <h2>1 — The context disappears, in silence</h2>

        <button type="button" className="kill" onClick={onKill}>
          Kill the WebGL context
        </button>
        <p className="note">
          What a driver reset, a GPU switch, or one canvas too many does to you
          without warning. Nothing throws and no error boundary fires.
        </p>

        {unsupported && (
          <p className="warn">
            This browser will not hand over <code>WEBGL_lose_context</code>, or
            the renderer is not up yet, so the loss cannot be simulated here.
          </p>
        )}

        <Toggle
          label="Let the application notice"
          hint="Uncheck this and kill the context: no notice, no error, and the render loop keeps running at full speed into a context that ignores every draw call. Watch the fps counter while the screen stays black."
          checked={detectLoss}
          onChange={onDetectLoss}
        />
        {blind && (
          <p className="warn">
            The scene is dead right now. Every counter above still reads
            healthy, the render loop is still running at full speed into a
            context that ignores it, the console holds one line nobody is
            watching, and the logs you ship are clean. This is what your users
            see, and it is why they report a slow page instead of a broken one.
            <br />
            <button type="button" className="inline" onClick={onRestore}>
              restore the context
            </button>{' '}
            ·{' '}
            <button type="button" className="inline" onClick={onReset}>
              rebuild the scene
            </button>
          </p>
        )}
        <p className="note">
          Note what is <em>not</em> here. Every guide tells you to call{' '}
          <code>preventDefault()</code> on the loss event or the browser never
          fires <code>webglcontextrestored</code>. That is true of a canvas you
          drive yourself, and redundant in any three.js app: the renderer
          attaches its own listener at construction and calls it for you. What
          three.js does not do is tell your application — it logs a line and
          stops painting, and React hears nothing.
        </p>
      </section>

      <section>
        <h2>2 — A depth-reading effect floods the driver</h2>

        <Toggle
          label="Antialias with SMAA instead of MSAA"
          hint="The ordinary, recommended way to antialias a chain. Nothing about reaching for it looks risky. Watch the gl errors counter, not the edges."
          checked={smaa}
          onChange={onSmaa}
        />
        <p className="note">
          SMAAEffect declares <code>EffectAttribute.DEPTH</code>. That makes the
          composer clone the input buffer&rsquo;s depth texture into a
          &ldquo;stable&rdquo; one, and a cloned three.js texture shares its
          Source: both are one image on the card. The composer then asks the
          driver to copy that image onto itself, once per frame, forever.
        </p>
        {smaa && stats?.glErrors > 0 && (
          <p className="warn">
            {stats.glErrors} refused blits, and counting. Nothing is drawn
            wrong, which is what makes it easy to dismiss — but the flood is
            expensive enough to leave the tab unable to respond, at which point
            every control on the page looks broken and the cause is nowhere
            near the controls. Seven other effects carry the same attribute:
            Bokeh, Depth, DepthOfField, GodRays, RealisticBokeh, SelectiveBloom
            and SSAO.
          </p>
        )}
      </section>

      <section>
        <h2>Claims that did not survive measurement</h2>
        <p className="note">
          The README walks through four. Two of them are checkable from this
          panel: the switch below, and the note under section 1 about
          <code> preventDefault()</code>. Check them rather than believe either
          of us.
        </p>

        <Toggle
          label="Rebuild the effect chain after a restore"
          hint="The usual advice, because the composer's render targets belonged to the dead context. Turn it on, kill, restore, and watch the gl errors counter rather than the picture."
          checked={rebuildChain}
          onChange={onRebuildChain}
        />
        <p className="note">
          Off, the same composer keeps rendering straight through a loss and the
          image is identical: three.js drops its resource bookkeeping on{' '}
          <code>webglcontextrestored</code> and re-uploads lazily, and the
          composer&rsquo;s targets come back with everything else. On, the old
          composer is disposed <em>after</em> the context is back, so three.js
          deletes GPU objects belonging to the generation that died against a
          context that has since been revived. The browser prints{' '}
          <code>INVALID_OPERATION: delete: object does not belong to this
          context</code> once per object, and the multisample resolve then fails
          every frame after that. Cargo cult with a bill attached.
        </p>
        <p className="note">
          The second claim is that an <code>EffectComposer</code> written inline
          leaks GPU memory, by tearing down its pass list on every render of the
          component holding it. On <code>@react-three/postprocessing</code>{' '}
          3.1.1 the pass list is diffed rather than compared by identity, so a
          re-render rebuilds nothing at all — measured at zero{' '}
          <code>addPass</code>/<code>removePass</code> over 150 renders — and
          the teardown disposes what it removes anyway. Memoise the chain for
          the ordinary reason, not for that one.
        </p>
      </section>

      <section>
        <h2>Two image traps, while we are here</h2>
        <p className="note">
          Neither of these stops the scene working. They are here because both
          are routinely blamed on the effects library, and neither is its
          fault.
        </p>

        <Toggle
          label="Tone mapping inside the chain"
          hint="Uncheck and watch the blacks lift. Mounting an EffectComposer drops the renderer's tone curve, so what you lose is what you had before adding effects at all, not something the effects did."
          checked={toneMapping}
          onChange={onToneMapping}
        />

        <Toggle
          label="Bloom threshold above the lit surfaces"
          hint="Uncheck and watch the knot in the middle, not the spheres. A luminance threshold cannot tell a lamp from a brightly lit object; the gap between what emits and what is merely lit is what makes it possible."
          checked={aboveLit}
          onChange={onAboveLit}
        />
      </section>

      <footer>
        <a href="https://github.com/QuentinBretl/r3f-resilience">
          Source and notes on GitHub
        </a>
      </footer>
    </aside>
  );
}
