function Toggle({ label, hint, checked, onChange, danger }) {
  return (
    <label className={danger ? 'toggle danger' : 'toggle'}>
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

export default function Panel({
  tier,
  resolved,
  profile,
  stats,
  aboveLit,
  toneMapping,
  churn,
  memoise,
  onTier,
  onAboveLit,
  onToneMapping,
  onChurn,
  onMemoise,
  onKill,
}) {
  return (
    <aside className="panel">
      <header>
        <h1>r3f-resilience</h1>
        <p>
          Three ways a React Three Fiber scene dies in production, and the code
          that keeps it alive. Break it on purpose below.
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
          <div>
            <dt>dpr range</dt>
            <dd>{profile.dpr.join(' – ')}</dd>
          </div>
          <div>
            <dt>antialiasing</dt>
            <dd>{profile.smaa ? 'SMAA' : `MSAA ${profile.multisampling}`}</dd>
          </div>
          <div>
            <dt>shadows</dt>
            <dd>{profile.shadows ? 'on' : 'off'}</dd>
          </div>
          <div>
            <dt>bloom</dt>
            <dd>{profile.bloom ? 'on' : 'off'}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h2>Live</h2>
        <dl className="grid">
          <div>
            <dt>fps</dt>
            <dd>{stats?.fps ?? '—'}</dd>
          </div>
          <div>
            <dt>pixel ratio</dt>
            <dd>{stats?.pixelRatio ?? '—'}</dd>
          </div>
          <div>
            <dt>shader programs</dt>
            <dd>{stats?.programs ?? '—'}</dd>
          </div>
          <div className={churn && !memoise ? 'leaking' : undefined}>
            <dt>textures</dt>
            <dd>{stats?.textures ?? '—'}</dd>
          </div>
        </dl>
        <p className="note">
          Both counts should settle after warm-up and then stay flat. A number
          that climbs while nothing changes on screen is a GPU leak. Use them
          to check the claims in this panel rather than believing them.
        </p>
      </section>

      <section>
        <h2>Break it</h2>

        <button type="button" className="kill" onClick={onKill}>
          Kill the WebGL context
        </button>
        <p className="note">
          What a driver reset, a GPU switch or one canvas too many does to you,
          unannounced. Nothing throws, no error boundary fires. Without
          <code> preventDefault()</code> on the event, the loss is permanent.
        </p>

        <Toggle
          label="Re-render the effect host 30×/s"
          hint="Stands in for a component subscribed to a context that updates constantly."
          checked={churn}
          onChange={onChurn}
        />

        <Toggle
          label="Memoise the effect chain"
          hint="Off with churn on, the composer tears down its pass list and rebuilds it on every render."
          checked={memoise}
          onChange={onMemoise}
        />

        {churn && !memoise && (
          <p className="warn">
            Rebuilding the chain 30×/s. The counters above are the point: on
            @react-three/postprocessing 3.0.4 they stay flat, because the
            composer now disposes what it removes. The widely repeated claim
            that this leaks GPU memory is out of date on this version. What it
            does cost is a pass teardown and shader recompilation per render,
            which is CPU time and frame pacing.
          </p>
        )}
      </section>

      <section>
        <h2>Post-processing</h2>

        <Toggle
          label="Tone mapping inside the chain"
          hint="An EffectComposer leaves the renderer on NoToneMapping. Turn this off to see the washed-out image people blame on the effects."
          checked={toneMapping}
          onChange={onToneMapping}
        />

        <Toggle
          label="Bloom threshold above the lit surfaces"
          hint="On: only the emissive spheres glow. Off: the threshold drops under what the key light produces, and the pale centrepiece smears with them."
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
