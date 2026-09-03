# r3f-resilience

A React Three Fiber scene that breaks on purpose, so you can watch a silent
WebGL failure happen - and check four widely repeated fixes for it, three of
which do not survive being measured.

It comes out of Lycanthropia, a multiplayer browser game where this happened
for real, on other people's hardware, during sessions that lasted an hour. What
makes these failures expensive is not that they are hard to fix. It is that
**nothing in JavaScript ever sees them**: no exception, no error boundary, no
rejected promise, no failed request. The scene simply stops being right, the
logs stay clean, and users describe it as "slow".

Which is also why so much of the advice about them is wrong in a way nobody
notices. If you cannot see the failure, you cannot see that your fix did
nothing.

```bash
npm install
npm run dev
```

Every switch in the demo removes one piece of real code, and every claim on
this page is a number on screen that moves while you watch.

## The instrument

A WebGL error is not thrown. The browser prints it to the console and returns
normally, so nothing that wraps the console API can see it, no logger catches
it, and reading the code will not tell you which call is failing. That is why
the problem in section 2 took four wrong theories to pin down, two of which I
had already shipped as fixes.

The way out is to stop reading and start counting. `demo/glProbe.js` wraps the
call under suspicion and reads the error queue immediately after it:

```js
proto.blitFramebuffer = function (...args) {
  state.blits += 1;
  const result = original.apply(this, args);
  if (this.getError() !== 0) state.errors += 1;   // ← the whole idea
  return result;
};
```

That turns "something somewhere is wrong" into a call site, a stack, and the
**gl errors** counter in the demo panel. `getError()` is a synchronous round
trip to the driver, which is why this is instrumentation and not production
code — but a handful of blits per frame makes it cheap enough to leave armed
while you work.

## 1 — A lost context is silent, and silence is the whole problem

Contexts are lost for reasons entirely outside your code: a driver reset, a
laptop switching between integrated and discrete GPUs, a background tab
reclaimed by the browser, or one WebGL context too many on the page (browsers
cap it around sixteen and drop the oldest without asking).

Uncheck **Let the application notice** in the demo, kill the context, and look
at the whole page rather than at the canvas. The scene is black. Every counter
in the panel still reads healthy. The render loop is still running at full
speed into a context that ignores every draw call. Nothing throws, no error
boundary fires, no promise rejects, and the only trace anywhere is one line in
a console nobody has open:

```
THREE.WebGLRenderer: Context Lost.
```

That is the failure. Not that the scene cannot come back - it can, and you will
see below how little you have to do about that - but that **your application is
never told**, so your users are the monitoring. They see a black rectangle,
read it as a slow page, and never file a report. My logs were clean for weeks.

So the job is detection, and then three small things:

- **Say something.** A notice over the canvas costs nothing and turns a silent
  failure into a support ticket you can act on.
- **Stop rendering.** A lost context still accepts draw calls, it simply
  ignores them. `frameloop: 'never'` while lost saves a few hundred pointless
  frames a second, and the demo deliberately leaves the loop running when
  detection is off so you can watch that happen.
- **Cover the canvas, do not replace it.** Restoring works on the canvas still
  mounted underneath the notice. Swap the `<Canvas>` out for a fallback and
  React will happily mount you a new one later - at the price of a fresh
  context, every shader recompiled and every texture re-uploaded.

Two details that do carry real weight:

- **Detach the listeners** on unmount *and* before attaching to a new canvas.
  react-three-fiber calls `gl.forceContextLoss()` itself when a Canvas
  unmounts, to hand the context back to the GPU, and that fires a perfectly
  ordinary `webglcontextlost`. Leave a listener attached and every route change
  is reported to your users as a crash.
- **`getExtension()` returns `null` while a context is lost**, by
  specification. So `WEBGL_lose_context` has to be captured while the context
  is still alive. `restoreContext()` in `src/contextLoss.js` reads a cache that
  `loseContext()` filled, which is the only reason the demo's restore button
  works at all.

```jsx
const { onCreated, lost } = useWebGLContextLoss();

<div style={{ position: 'relative' }}>
  <Canvas frameloop={lost ? 'never' : 'always'} onCreated={onCreated}>{/* ... */}</Canvas>
  {lost && <SceneUnavailable />}
</div>
```

A side effect worth knowing: while the context is gone and the loop is stopped,
the counters **freeze** rather than fall to zero, because nothing samples them.
They climb back on restore.

One more consequence of that `getExtension` rule, and the reason this demo
never unmounts its Canvas. Tearing a Canvas down makes r3f call
`forceContextLoss()`; three.js asks for `WEBGL_lose_context` to carry it out,
gets `null` back on a context that is already gone, and warns
`THREE.WebGLRenderer: WEBGL_lose_context extension not supported.` It is
harmless, but it is noise on a page whose whole argument is that console noise
is the only signal you get — so the recovery button here restores the context
and rebuilds the effect chain instead, which reaches the same place without
spending a line on it.

Killing the context also makes the calls already in flight fail, which is why
the probe ignores errors raised while `isContextLost()` is true: a dead context
refuses everything, and counting that would drown the one number this page
exists to report.

## 2 — Any depth-reading effect blits a depth texture onto itself, every frame

Turn on **Antialias with SMAA** in the demo and the gl errors counter goes from
zero to roughly 230 per second. Measured here: 4245 blits and 0 errors on MSAA,
then 700 blits and **700 errors** in the first three seconds of SMAA. Every
single blit refused, and the console filling with one line per frame:

```
GL_INVALID_OPERATION: glBlitFramebuffer: Read and write depth stencil
attachments cannot be the same image.
```

Here is the whole chain, and every link is checkable in `node_modules`.

An effect declaring `EffectAttribute.DEPTH` makes the composer build a
"stable" depth target, in `EffectComposer.createDepthTexture`:

```js
const inputDepthTexture = new DepthTexture();
const stableDepthTexture = inputDepthTexture.clone();   // ← the bug
this.inputBuffer.depthTexture = inputDepthTexture;
this.depthRenderTarget = new WebGLRenderTarget(w, h, { depthTexture: stableDepthTexture });
```

But `Texture.prototype.copy` in three.js is, in part:

```js
this.source = source.source;
```

A cloned texture **shares its Source**, and three.js allocates one GPU texture
per Source. So the input buffer's depth texture and the "stable" one are the
same image on the card. `RenderPass` sets `needsDepthBlit` unconditionally, so
after every scene render the composer calls `blitDepthBuffer`, which binds that
one image as both `READ_FRAMEBUFFER` and `DRAW_FRAMEBUFFER` and asks the driver
to copy it onto itself. WebGL refuses, politely, sixty times a second.

Nothing is drawn wrong, which is what makes it easy to dismiss. But the flood
is expensive enough to leave the tab unable to respond, at which point every
control on your page looks broken and the cause is nowhere near the controls.

**The list of effects that reach it is longer than you would guess.** Grepping
`EffectAttribute.DEPTH` in `postprocessing` 6.39.4 gives eight:

`BokehEffect`, `DepthEffect`, `DepthOfFieldEffect`, `GodRaysEffect`,
`RealisticBokehEffect`, `SelectiveBloomEffect`, `SSAOEffect`, and **`SMAAEffect`**.

SMAA is the ordinary, recommended way to antialias a post-processing chain.
Nothing about reaching for it looks risky, and it carries the depth attribute
all the same. Removing selective bloom and switching to SMAA — which is exactly
what I did first — swapped one broken path for another and changed nothing.

Antialias with `multisampling` on the composer instead. MSAA is innocent here:
the failing call comes from `blitDepthBuffer`, not from the resolve path, and
the counter sits at zero with eight MSAA samples running.

The demo therefore uses no depth-reading effect at all. It separates lamps from
lit surfaces by putting the bloom threshold in the gap between what is lit and
what emits, which is the more durable lesson anyway: an emissive material at 4
and a lit surface topping out near 1 leave somewhere for a threshold to land,
and no library has to cooperate.

## Four claims that did not survive measurement

Every one of these is repeated widely, and I believed all four. Three of them
were the load-bearing advice in the first version of this README. Measurement
is the only reason they are not any more.

**"Call `preventDefault()` on `webglcontextlost` or the loss is permanent."**
True, and already done for you. On a bare canvas the difference is absolute:
without the call, `restoreContext()` returns without throwing and without doing
anything, and `isContextLost()` stays `true` forever; with it, the context comes
back. But three.js attaches its own `webglcontextlost` listener when the
renderer is constructed and calls `preventDefault()` inside it - `WebGLRenderer`,
`onContextLost`, `three.module.js:29380` on 0.169. No three.js or r3f
application has ever needed to write that line. This claim was the headline of
this repo until I checked it.

**"Unmount the Canvas and the loss becomes permanent, because you destroy the
object that receives `webglcontextrestored`."** The reasoning is right and the
outcome is not. Replacing the `<Canvas>` with a fallback and then restoring: the
orphaned canvas still receives the event, React mounts a new Canvas, and the
scene comes back. What it actually costs is a full rebuild - new context, every
program recompiled, every texture re-uploaded - which is a good reason to cover
rather than replace, and not the catastrophe the advice describes.

**"Rebuild the effect chain after a context restore, or it stays broken."**
This one is worse than wrong: on these versions it is the destructive option.
The reasoning is sound - the composer owns render targets that belonged to the
dead context, and three.js only re-uploads what it still holds references to -
but leaving the chain alone works. Same composer instance, same image, error
counter flat.

Ask for the rebuild and here is what you buy. The old composer is disposed
*after* the context has come back, so three.js walks its resources and deletes
GPU objects belonging to the generation that died, against a context that has
since been revived. The browser prints

```
WebGL: INVALID_OPERATION: delete: object does not belong to this context
```

once per object - forty of them in one run here - followed by
`deleteVertexArray` failures out of `onGeometryDispose`, and from then on the
multisample resolve fails on every single frame, which the demo's counter picks
up as a number that never stops climbing. Toggle **Rebuild the effect chain
after a restore** and watch it happen.

The timing is the whole story, and it is why this took a bug report from
someone clicking around to surface at all. Rebuild *while* the context is still
lost and it is harmless, because a lost context silently ignores every call it
is given, deletes included. Rebuild *after* the restore and every one of those
deletes is a real call against a real context that never owned those objects.
The advice never mentions when, because the person giving it never had a
counter on the page.

**"An `EffectComposer` written inline leaks GPU memory."** The claim is that it
tears its pass list down and rebuilds it on every render of the component
holding the JSX, and that `removePass` is not paired with a dispose. Two things
have changed. The teardown effect now calls `removePass` and
`disposeGeneratedPass` together, so nothing leaks. And the pass list is rebuilt
on a *diff* of the effect nodes rather than on `children` identity, so an
ordinary re-render rebuilds nothing at all: patching `addPass`/`removePass` and
re-rendering the host thirty times a second for five seconds gives **zero** of
either, while one real change to the chain gives one of each. Memoise your chain
for the ordinary reasons; this is no longer one of them.

That leaves exactly one failure in this repo that is both silent and genuinely
destructive, and it is section 2 above. I would rather ship a demo that says so
than four switches that pretend otherwise.

A last word on method, since it cost me twice in one evening. I "verified" this
page by capturing `console.error` and `console.warn` and reporting a clean
console. That check was worthless: `WebGL: INVALID_OPERATION` never goes through
the console API, so a wrapper around it sees nothing. Neither does an automated
console reader driving the browser - I tried, and the deletes are invisible to
it too. The only two things that caught this were the counter on the page and a
human being looking at a real console. Which is, uncomfortably, the exact thesis
of this repo, applied to the repo.


## The device budget

Not a failure you can watch on a desktop, but the one that decides whether a
phone renders your scene or reloads the tab. `resolveQualityTier` returns
`'perf'` or `'high'` from the user agent, touch points, cores and device
memory, and is deliberately free of any `three` import: you usually need the
tier *before* the Canvas exists, to decide what to mount at all.

The probe is optimistic on missing data. `hardwareConcurrency` and
`deviceMemory` are absent on Safari and Firefox, and downgrading whenever they
are missing would punish every Safari user for their browser's privacy stance.
Cores alone are a poor signal too, since an eight-core phone is still a phone,
so the desktop downgrade needs both signals to agree.

In the profiles, `shadows` is by far the heaviest line and it is not close: a
single shadow-casting point light renders the scene six times per frame, once
per cube-map face. Everything else put together costs less than turning that
one flag on, which is why the perf tier drops it first and keeps antialiasing.

## Two image traps, while we are here

Neither stops the scene working. Both are routinely blamed on the effects
library, and neither is its fault.

**Adding post-processing washes out your colour grade.** Mounting an
`EffectComposer` leaves the renderer on `NoToneMapping`, so what you lose is the
curve you had before, not something the effects added. Put a `ToneMapping` pass
back *inside* the chain and it returns.

**A luminance threshold cannot tell a lamp from a lit cheek.** Bloom sorts by
brightness, and brightness does not know intent. Build a gap instead: give what
should glow an emissive value well above 1, keep everything else under it, and
put the threshold between them. And run bloom *before* tone mapping — once tone
mapping has compressed everything into 0..1, a cheek in full moonlight and a
lamp are both "about 0.9", and no threshold separates them.

Equal emissive intensity does not mean equal brightness to a threshold, either.
Luminance weights green at 0.72 against 0.21 for red and 0.07 for blue, so at a
single intensity the demo's amber lamp measured 3.15, the cyan 3.35 and the
rose 1.73 — and the rose one sat unlit next to two glowing neighbours, which
reads as a bug because it is one. `demo/Scene.jsx` derives each lamp's
intensity from its colour instead.

One detail worth knowing if you reach for a layer-based selective effect
anyway: layers are **per object and not inherited**, so enabling one on a group
does nothing for its children. The same mechanism drives selective *lighting* —
a light illuminates an object only when `light.layers.test(object.layers)`
passes — and that has none of the depth problem above.

## What is in here

`src/` is three small files, kept separate from the demo so the demo imports
them the way a consumer would. It is not published to npm and is not meant to
be: copy what you need.

| Export | What it does |
| --- | --- |
| `useWebGLContextLoss(opts?)` | `{ onCreated, lost, reset }`. Hand `onCreated` to the Canvas. `recover: false` drops the `preventDefault`, which is what the demo's first switch does. |
| `resolveQualityTier(quality?)` | `'perf'` or `'high'` from the device. SSR safe. Pass a tier to force it. |
| `getQualityProfile(quality?)` | Resolves the tier and returns its profile. |
| `QUALITY_PROFILES` | The two budgets. Spread them to add project flags. |
| `loseContext` / `restoreContext` | Drop and restore a context on purpose, to exercise recovery. |
| `countPrograms(renderer)` | Compiled shader programs. Your leak detector. |

There is no renderer here, no engine, no component library, no asset loading
and no state management. It is the handful of things that turned out to be
load-bearing once a scene had to survive strangers on unknown hardware.

## Where these numbers come from

Measured in September 2026, on Chrome / Windows 11, with `three` 0.169.0,
`postprocessing` 6.39.4, `@react-three/postprocessing` 3.1.1 and
`@react-three/fiber` 9.7.0 — pinned exactly in `package.json`, because three of
the findings above are statements about specific versions and would be
worthless without them. One machine, one
browser. If yours differ, that is what the demo is for: rerun it and see what
your numbers say.

## Licence

MIT
