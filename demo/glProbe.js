// A GL error is printed by the browser and never raised through JavaScript.
// No exception, no error boundary, nothing that watches the console API can
// see it, and no amount of reading the code will tell you which call is
// failing. So wrap the call you suspect and read the error queue right after
// it: that turns "something somewhere is wrong" into a call site, a stack and
// a number you can put on screen.
//
// This is armed on every load rather than behind a debug flag, because the
// number is the demonstration. It is what separates "the antialiasing looks
// fine to me" from "the driver is refusing this call sixty times a second".

const state = { blits: 0, errors: 0, firstStack: null };
let armed = false;

export function armGLProbe() {
  const proto = globalThis.WebGL2RenderingContext?.prototype;
  if (armed || !proto) return;
  armed = true;

  const original = proto.blitFramebuffer;
  proto.blitFramebuffer = function patchedBlitFramebuffer(...args) {
    state.blits += 1;
    const result = original.apply(this, args);

    // A lost context fails every call it is given, so counting those would
    // mean the kill button raises the alarm this counter exists to raise.
    // Errors are only interesting while the context is alive.
    if (this.isContextLost()) return result;

    // getError() is a synchronous round trip to the driver, which is exactly
    // why you would not ship this. A handful of blits per frame makes it
    // affordable here, where reporting the number is the entire point.
    if (this.getError() !== 0) {
      state.errors += 1;
      if (!state.firstStack) {
        state.firstStack = new Error('blitFramebuffer').stack;
        // Printed once. This single line is what named the culprit after four
        // wrong theories, two of which had already been shipped as fixes.
        console.warn('[glProbe] first failing blit:\n' + state.firstStack);
      }
    }
    return result;
  };
}

export function readGLProbe() {
  return { blits: state.blits, errors: state.errors };
}

export function resetGLProbe() {
  state.blits = 0;
  state.errors = 0;
  state.firstStack = null;
}
