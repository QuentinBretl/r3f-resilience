# Findings

The long version of what the [README](README.md) summarises. Every number here
was measured in September 2026 on Chrome / Windows 11, against the versions
pinned in `package.json`.

---

## The depth blit, in full

Turn on **Antialias with SMAA** in the [demo](https://r3f-resilience.vercel.app/)
and the console fills with one line per frame:

```
GL_INVALID_OPERATION: glBlitFramebuffer: Read and write depth stencil
attachments cannot be the same image.
```

Every link in the chain is checkable in `node_modules`.

An effect declaring `EffectAttribute.DEPTH` makes the composer build a "stable"
depth target, in `EffectComposer.createDepthTexture`:

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

A cloned texture **shares its Source**, and three.js allocates one GPU texture per
Source. So the input buffer's depth texture and the "stable" one are the same
image on the card. `RenderPass` sets `needsDepthBlit` unconditionally, so after
every scene render the composer calls `blitDepthBuffer`, which binds that one
image as both `READ_FRAMEBUFFER` and `DRAW_FRAMEBUFFER` and asks the driver to
copy it onto itself.

Measured: **4245 blits and 0 errors** with MSAA, then **700 blits and 700
errors** in the first three seconds of SMAA. A 100% failure rate, about 230 per
second.

### Why it took four wrong theories

Because nothing is drawn wrong. The image is correct, the frame rate looks
survivable, and no exception is ever raised. The first three theories — a leaking
composer, MSAA on the wrong buffer, selective bloom — each produced a fix that
changed nothing, and there was no way to tell, because the only signal was a
console I was not reading.

Removing selective bloom and switching to SMAA, which is exactly what I did
first, swapped one broken path for another and looked like progress.

What ended it was wrapping `blitFramebuffer` and calling `getError()` right
after, which printed a stack naming `EffectComposer.blitDepthBuffer` on the first
failing call.

### The eight effects that carry the attribute

Grepping `EffectAttribute.DEPTH` in `postprocessing` 6.39.4:

`BokehEffect`, `DepthEffect`, `DepthOfFieldEffect`, `GodRaysEffect`,
`RealisticBokehEffect`, `SelectiveBloomEffect`, `SSAOEffect`, `SMAAEffect`.

`ShockWaveEffect` is **not** among them, despite what an earlier version of this
document claimed — its constructor declares no attributes at all.

Antialias with `multisampling` on the composer instead. MSAA is innocent here:
the failing call comes from `blitDepthBuffer`, not from the resolve path, and the
counter sits at zero with eight MSAA samples running.

The demo therefore uses no depth-reading effect at all. It separates lamps from
lit surfaces by putting the bloom threshold in the gap between what is lit and
what emits, which is the more durable lesson anyway.

---

## The four claims

### "Call `preventDefault()` on `webglcontextlost` or the loss is permanent"

True, and already done for you.

On a bare canvas the difference is absolute. Measured both ways:

| | events fired | `isContextLost()` after `restoreContext()` |
| --- | --- | --- |
| without `preventDefault()` | `lost` | still `true`, forever |
| with `preventDefault()` | `lost`, `restored` | `false` |

`restoreContext()` on the first row does not throw and does not warn. It returns
having done nothing at all.

But three.js attaches its own `webglcontextlost` listener when the renderer is
constructed, and calls `preventDefault()` inside it — `WebGLRenderer`,
`onContextLost`, `three.module.js:29380` on 0.169. No three.js or r3f application
has ever needed to write that line. This claim was the headline of this repo
until I checked it.

### "Unmount the Canvas and the loss becomes permanent"

The reasoning is right — you do destroy the object that receives
`webglcontextrestored` — and the outcome is not.

Replacing the `<Canvas>` with a fallback and then restoring: the orphaned canvas
still receives the event, React mounts a new Canvas, and the scene comes back.
What it actually costs is a full rebuild: new context, every program recompiled,
every texture re-uploaded. That is a good reason to cover rather than replace,
and not the catastrophe the advice describes.

### "Rebuild the effect chain after a context restore, or it stays broken"

Worse than wrong: on these versions it is the destructive option.

The reasoning is sound. The composer owns render targets that belonged to the
dead context, and three.js only re-uploads what it still holds references to. But
leaving the chain alone works — measured by stamping the composer instance and
counting refused blits on both paths: with the chain re-keyed a new composer
appears after the restore; with it reused, the same instance keeps rendering, the
image is identical, and the error counter stays at zero.

Ask for the rebuild and here is what you buy. The old composer is disposed
*after* the context has come back, so three.js walks its resources and deletes
GPU objects belonging to the generation that died, against a context that has
since been revived:

```
WebGL: INVALID_OPERATION: delete: object does not belong to this context
```

once per object — forty of them in one run here — followed by `deleteVertexArray`
failures out of `onGeometryDispose`, and from then on the multisample resolve
fails on every single frame, which the counter picks up as a number that never
stops climbing.

**The timing is the whole story.** Rebuild *while* the context is still lost and
it is harmless, because a lost context silently ignores every call it is given,
deletes included. Rebuild *after* the restore and every one of those deletes is a
real call against a real context that never owned those objects. The advice never
mentions when, because the person giving it never had a counter on the page.

This one only surfaced because somebody clicked around the demo and pasted their
console.

### "An `EffectComposer` written inline leaks GPU memory"

The claim is that it tears its pass list down and rebuilds it on every render of
the component holding the JSX, and that `removePass` is not paired with a
dispose. Two things have changed.

The teardown effect now calls `removePass` and `disposeGeneratedPass` together,
so nothing leaks. And the pass list is rebuilt on a *diff* of the effect nodes
rather than on `children` identity, so an ordinary re-render rebuilds nothing at
all: patching `addPass`/`removePass` and re-rendering the host thirty times a
second for five seconds gives **zero** of either, while one real change to the
chain gives one of each.

Memoise your chain for the ordinary reasons. This is no longer one of them.

---

## A word on method

This cost me twice in one evening, so it belongs in the record.

I "verified" the demo by capturing `console.error` and `console.warn` and
reporting a clean console. That check was worthless: `WebGL: INVALID_OPERATION`
never goes through the console API, so a wrapper around it sees nothing. Neither
does an automated console reader driving the browser — I tried, and the deletes
are invisible to it too.

The only two things that caught it were the counter on the page and a person
looking at a real console. Which is, uncomfortably, the exact thesis of this
repository, applied to the repository.

---

## The device budget

Not a failure you can watch on a desktop, but the one that decides whether a
phone renders your scene or reloads the tab.

`resolveQualityTier` returns `'perf'` or `'high'` from the user agent, touch
points, cores and device memory, and is deliberately free of any `three` import:
you usually need the tier *before* the Canvas exists, to decide what to mount at
all.

The probe is optimistic on missing data. `hardwareConcurrency` and `deviceMemory`
are absent on Safari and Firefox, and downgrading whenever they are missing would
punish every Safari user for their browser's privacy stance. Cores alone are a
poor signal too, since an eight-core phone is still a phone, so the desktop
downgrade needs both signals to agree.

In the profiles, `shadows` is by far the heaviest line and it is not close: a
single shadow-casting point light renders the scene six times per frame, once per
cube-map face. Everything else put together costs less than turning that one flag
on, which is why the perf tier drops it first and keeps antialiasing.

---

## Two colour traps that get blamed on the effects library

Neither stops the scene working. Neither is the library's fault.

### Adding post-processing washes out your colour grade

Mounting an `EffectComposer` leaves the renderer on `NoToneMapping`, so what you
lose is the curve you had before, not something the effects added. Put a
`ToneMapping` pass back *inside* the chain and it returns.

### A luminance threshold cannot tell a lamp from a lit cheek

Bloom sorts by brightness, and brightness does not know intent. Build a gap
instead: give what should glow an emissive value well above 1, keep everything
else under it, and put the threshold between them.

And run bloom *before* tone mapping. Once tone mapping has compressed everything
into 0..1, a cheek in full moonlight and a lamp are both "about 0.9", and no
threshold separates them.

Equal emissive intensity does not mean equal brightness to a threshold, either.
Luminance weights green at 0.72 against 0.21 for red and 0.07 for blue, so at a
single intensity the demo's amber lamp measured 3.15, the cyan 3.35 and the rose
1.73 — and the rose one sat unlit next to two glowing neighbours, which reads as
a bug because it is one. `demo/Scene.jsx` derives each lamp's intensity from its
colour instead.

One detail worth knowing if you reach for a layer-based selective effect anyway:
layers are **per object and not inherited**, so enabling one on a group does
nothing for its children. The same mechanism drives selective *lighting* — a
light illuminates an object only when `light.layers.test(object.layers)` passes —
and that has none of the depth problem above.
