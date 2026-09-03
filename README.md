# r3f-resilience

Keeping a React Three Fiber scene alive in production is a different job from
getting one on screen. This is a small set of utilities and a demo you can break
on purpose, extracted from a live multiplayer browser game after the failures
below happened for real.

Three of them, in the order they cost me the most time:

1. **The context goes away and nothing tells you.** No exception, no error
   boundary, `useFrame` keeps running. The canvas just stops painting.
2. **A quality tier is not a settings menu.** It is the difference between a
   phone rendering your scene and a phone reloading the tab.
3. **Post-processing is where the received wisdom is wrong**, in both
   directions: it costs you things nobody warns about, and it is blamed for one
   thing it no longer does.

The demo lets you trigger all three from a panel and watch the counters move.

```bash
npm install
npm run dev
```

## The failures, and what actually causes them

### A lost WebGL context is silent

Contexts are lost for reasons entirely outside your code: a driver reset, a
laptop switching between integrated and discrete GPUs, a background tab
reclaimed by the browser, or simply one WebGL context too many on the page.
Browsers cap it around sixteen and drop the oldest without asking.

Three details carry the recovery, and all three are easy to miss.

`event.preventDefault()` on `webglcontextlost` is **mandatory**. The default
action of that event is, counter-intuitively, to give up: without the call the
browser never fires `webglcontextrestored` and the loss is permanent.

The listener must be **detached on unmount**. react-three-fiber calls
`gl.forceContextLoss()` itself when a Canvas unmounts, to hand the context back
to the GPU. That fires a perfectly ordinary `webglcontextlost`. Leave the
listener attached and every route change is reported to your users as a crash.

And `getExtension()` **returns null while a context is lost**, by
specification. So the `WEBGL_lose_context` object has to be captured while the
context is still alive, or the moment you want to restore you will be handed
nothing. `restoreContext` here reads a cache that `loseContext` filled, which
is the only reason it works at all.

Keep the Canvas mounted and lay a notice over it, rather than unmounting it.
Unmounting was my first instinct and it is wrong twice over: a black rectangle
reads as a slow page so nobody reports it, and tearing the canvas down destroys
the only object that can ever receive `webglcontextrestored`, so the scene can
never come back. Cover it instead, and drop `frameloop` to `never` meanwhile: a
lost context still accepts draw calls, it simply ignores them, and there is no
reason to render into the void several hundred times a second while someone
reads your message.

```jsx
import { useWebGLContextLoss } from 'r3f-resilience';

function Stage() {
  const { onCreated, lost } = useWebGLContextLoss({
    onLost: () => track('webgl_context_lost'),
  });

  return (
    <div style={{ position: 'relative' }}>
      <Canvas frameloop={lost ? 'never' : 'always'} onCreated={onCreated}>
        {/* … */}
      </Canvas>
      {lost && <SceneUnavailable />}
    </div>
  );
}
```

### An EffectComposer written inline rebuilds itself on every render

An `EffectComposer` rebuilds its pass list whenever `children` changes identity,
which in React means on **every render of the component holding the JSX**. So a
composer written inline inside a component that re-renders often, and "often"
here means any component subscribed to a context that updates on every incoming
message, tears its passes down and builds them again several times a second.

The widely repeated conclusion is that this leaks GPU memory, on the grounds
that `removePass` is not paired with a dispose. **I measured it, and on
`@react-three/postprocessing` 3.0.4 that is no longer true.** The teardown
effect calls `removePass` and `disposeGeneratedPass` together, and with the
chain rebuilt thirty times a second in the demo, both the shader program count
and the texture count stay flat. The counters are on screen so you can check
that for yourself rather than taking my word for it, or anyone else's.

The advice survives the correction, for its own reason rather than a borrowed
one: rebuilding passes and recompiling shaders at 30 Hz is CPU time and frame
pacing spent on nothing at all. Hoist the chain, memoise it, and give it props
whose identity is stable.

```jsx
// Module scope, memoised, no props whose identity changes.
const Effects = memo(({ profile }) => (
  <EffectComposer multisampling={profile.multisampling}>
    <Bloom intensity={2.4} luminanceThreshold={0.6} mipmapBlur />
    <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
  </EffectComposer>
));
```

If you are on an older major version, measure before you assume you are safe.
`renderer.info.programs.length` and `renderer.info.memory.textures` are the two
numbers that settle after warm-up and should then never move.

### A restored context is not a restored scene

Getting the canvas painting again is only half of it. Every GPU resource
created before the loss is gone, and three.js re-uploads only what it still
holds references to. Anything holding render targets of its own has to be
rebuilt, and an `EffectComposer` is exactly that.

The demo gives the chain a `key` that changes on every restore, which is the
blunt and reliable way to make React rebuild it from nothing.

The counters make it visible: kill the context and both fall to zero, restore
it and they climb back as the scene re-uploads everything it needs.

### Selective bloom blits a depth texture onto itself, every frame

If your console fills, one line per frame, with

```
GL_INVALID_OPERATION: glBlitFramebuffer: Read and write depth stencil
attachments cannot be the same image.
```

it is not your code. Here is the whole chain, and every link is checkable.

`SelectiveBloomEffect` declares `EffectAttribute.DEPTH`, because it re-renders
the scene and needs the depth buffer. The composer answers that by building a
"stable" depth target, in `EffectComposer.createDepthTexture`:

```js
const inputDepthTexture = new DepthTexture();
const stableDepthTexture = inputDepthTexture.clone();   // ← the bug
this.inputBuffer.depthTexture = inputDepthTexture;
this.depthRenderTarget = new WebGLRenderTarget(w, h, { depthTexture: stableDepthTexture });
```

But `Texture.prototype.copy` in three.js is

```js
this.source = source.source;
```

A cloned texture **shares its Source**, and three.js allocates one GPU texture
per Source. So the input buffer's depth texture and the "stable" one are the
same image on the card. `RenderPass` sets `needsDepthBlit = true`
unconditionally, so after every scene render the composer calls
`blitDepthBuffer`, which binds that one image as both `READ_FRAMEBUFFER` and
`DRAW_FRAMEBUFFER` and asks the driver to copy it onto itself. WebGL refuses,
politely, sixty times a second.

Nothing is drawn wrong, which is what makes it easy to dismiss. But the flood
is expensive enough to leave the tab unable to respond, at which point every
control on your page looks broken and the cause is nowhere near the controls.
Chrome eventually gives up printing and says so.

Any effect carrying `EffectAttribute.DEPTH` reaches it: depth of field, god
rays, SSAO, selective bloom. Measured on `postprocessing` 6.39.4 with
three 0.169.

The demo therefore does not use `SelectiveBloom`. It puts the bloom threshold
in the gap between what is lit and what emits instead, which is the more
durable lesson: an emissive material at 4 and a lit surface topping out near 1
leave somewhere for a threshold to land, and no library has to cooperate.

`useSelectionLayer` stays in this library, because the layer mechanism itself
is sound and is what you want the day the composer stops cloning that texture.
It also drives selective *lighting* today, which has no such problem.

**How this was found**, because the method matters more than the bug: GL errors
are printed by the browser and never raised through JavaScript, so nothing that
watches the console API can see them, and no amount of reading the code was
going to settle it. Load the demo with `?gl=debug` and it wraps
`blitFramebuffer`, checks the error queue right after each call, and prints the
count and the first failing stack five seconds in. That stack named
`EffectComposer.blitDepthBuffer` in one line, after three wrong theories of
mine that all sounded reasonable.

### Adding post-processing washes out your colour grade

A frequent conclusion is that the effects library "ruins the image". It does
not. Mounting an `EffectComposer` leaves the renderer on `NoToneMapping`, so
what you lose is the curve you had before, not something the effects added.
Putting a `ToneMapping` pass back **inside** the chain restores it. The demo has
a switch for it, and the difference is not subtle.

### A luminance threshold cannot tell a lamp from a lit cheek

Bloom sorts by brightness, and brightness does not know intent. Raise the
threshold until faces stop glowing and the lamps stop glowing too.

Two ways out. The one that always works: build a gap. Give the things that
should glow an emissive value well above 1, keep everything else lit under it,
and put the threshold between them. Nothing has to cooperate.

The one that is nicer in principle and currently broken in practice: sort by
layer, so what blooms is a decision rather than a number you keep re-tuning.

```jsx
useSelectionLayer(model, BLOOM_LAYER);
// …
<SelectiveBloom selectionLayer={BLOOM_LAYER} lights={lights} mipmapBlur />
```

Read the section above before reaching for it: on the current release that
path blits a depth texture onto itself once a frame.

Three things worth knowing about it anyway. Layers are **per object and not inherited**, so
enabling one on a group does nothing for its children, hence the traversal in
the hook. The same mechanism drives selective *lighting*: a light illuminates
an object only when `light.layers.test(object.layers)` passes, so a light alone
on a layer lights only the meshes that opted in.

And `SelectiveBloom` wants your **lights** passed to it, not just the
selection. To isolate the selection it re-renders it into a buffer of its own,
and by the rule just above, a light that is not on the selection layer does not
reach it. Handing the lights over is how the library enables that layer on
them. Omit them and it logs `SelectiveBloom requires lights to work.` on every
mount; the effect still runs, but only emissive materials contribute, because
everything else comes out as a black silhouette.

### Order matters more than parameters

Run bloom **before** tone mapping. Tone mapping compresses everything into
0..1, and once it has, a cheek in full moonlight and a lamp are both "about
0.9": no threshold separates them. Run bloom first and it reads real values,
where a lit surface tops out near 1 while an emissive material sits at 4. That
gap is the whole trick.

### Canvas props, quietly

react-three-fiber's configuration effect has no dependency array. It replays on
every render of the component holding the `<Canvas>`, so object literals written
inline are rebuilt and reapplied several times a second, forever. Hoist them:

```jsx
const CAMERA = { position: [0, 2.6, 7], fov: 45 };
const GL = { antialias: true };
// …
<Canvas camera={CAMERA} gl={GL} onCreated={stableCallback} />
```

`memo` on the surrounding component does not save you here: a memoised
component that reads a React context still re-renders on every context update.

## API

```js
import {
  resolveQualityTier,
  getQualityProfile,
  QUALITY_PROFILES,
  useWebGLContextLoss,
  useSelectionLayer,
  loseContext,
  restoreContext,
  countPrograms,
} from 'r3f-resilience';
```

| Export | What it does |
| --- | --- |
| `resolveQualityTier(quality?)` | `'perf'` or `'high'` from user agent, touch, cores and device memory. SSR safe. Pass `'perf'`/`'high'` to force. |
| `getQualityProfile(quality?)` | Resolves the tier and returns its profile. |
| `QUALITY_PROFILES` | The two budgets. Spread them to add project flags. |
| `useWebGLContextLoss(opts?)` | `{ onCreated, lost }`. Hand `onCreated` to the Canvas. |
| `useSelectionLayer(object, layer, enabled?)` | Enables a layer across a subtree, and disables it on cleanup. |
| `loseContext(renderer)` | Drops the context via `WEBGL_lose_context`, to test recovery. Returns `false` if unsupported. |
| `restoreContext(renderer)` | Restores a simulated loss, using the extension captured by `loseContext`. |
| `countPrograms(renderer)` | Compiled shader programs. Your leak detector. |

`resolveQualityTier` is deliberately free of any `three` import: you usually
need the tier *before* the Canvas exists, to decide what to mount at all.

The device probe is optimistic on missing data. `hardwareConcurrency` and
`deviceMemory` are absent on Safari and Firefox, and downgrading whenever they
are missing would punish every Safari user for their browser's privacy stance.
Cores alone are a poor signal too, since an eight-core phone is still a phone,
so the desktop downgrade needs both signals to agree.

In the profiles, `shadows` is by far the heaviest line and it is not close: a
single shadow-casting point light renders the scene six times per frame, once
per cube-map face. Everything else in the table put together costs less than
turning that one flag on, which is why the perf tier drops it first and keeps
antialiasing.

## What this is not

Not a renderer, not an engine, not a component library. There is no asset
loading, no scene graph helper, no state management. It is the handful of things
that turned out to be load-bearing once the scene had to survive strangers on
unknown hardware for an hour at a time.

Requires React 18 or later, three r160 or later, and react-three-fiber 9.
`@react-three/postprocessing` is only needed for the demo.

## Licence

MIT
