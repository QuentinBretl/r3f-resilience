// Temporary instrumentation. Load the page with ?gl=debug to arm it.
//
// GL errors are printed by the browser, not raised through JavaScript, so they
// are invisible to any tooling that only watches the console API. This wraps
// the calls we suspect and checks the error queue right after each one, which
// turns "something somewhere is failing" into a call site and a stack.
export function armGLDebug() {
  if (!new URLSearchParams(location.search).has('gl')) return;

  const report = {
    blitCalls: 0,
    blitErrors: 0,
    firstBlitStack: null,
    contextAttributes: null,
    renderTargetSamples: [],
  };
  window.__glDebug = report;

  const proto = window.WebGL2RenderingContext?.prototype;
  if (!proto) return;

  const originalBlit = proto.blitFramebuffer;
  proto.blitFramebuffer = function patchedBlit(...args) {
    report.blitCalls += 1;
    const result = originalBlit.apply(this, args);
    const error = this.getError();
    if (error !== 0) {
      report.blitErrors += 1;
      if (!report.firstBlitStack) {
        report.firstBlitStack = new Error('blitFramebuffer').stack;
        report.contextAttributes = this.getContextAttributes();
        // The mask tells us what was asked for: 0x4000 colour, 0x100 depth,
        // 0x400 stencil.
        report.firstMask = args[8];
      }
    }
    return result;
  };

  const originalRenderbufferStorageMultisample =
    proto.renderbufferStorageMultisample;
  proto.renderbufferStorageMultisample = function patched(...args) {
    report.renderTargetSamples.push(args[1]);
    return originalRenderbufferStorageMultisample.apply(this, args);
  };

  // Anything React throws inside the Canvas is swallowed by the renderer and
  // leaves nothing but a black rectangle. Collect it here instead.
  report.errors = [];
  const originalError = console.error.bind(console);
  console.error = (...args) => {
    report.errors.push(args.map(String).join(' ').slice(0, 300));
    originalError(...args);
  };
  window.addEventListener('error', (event) => {
    report.errors.push('window: ' + (event.message || String(event.error)));
  });

  // Print itself, so using this needs nothing but the URL.
  const dump = () => {
    console.log('[glDebug] blitFramebuffer calls:', report.blitCalls,
      '| errors right after a blit:', report.blitErrors,
      '| multisampled render targets:', [...new Set(report.renderTargetSamples)]);
    if (report.firstBlitStack) {
      console.log('[glDebug] first failing blit:');
      console.log(report.firstBlitStack);
    }
  };
  setTimeout(dump, 5000);
  setTimeout(dump, 15000);

  console.warn('[glDebug] armed, report in 5s');
}
