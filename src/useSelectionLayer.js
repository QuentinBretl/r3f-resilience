import { useEffect } from 'react';

/**
 * Put a subtree on a rendering layer, so a selective effect can pick it out.
 *
 * Selective bloom is the usual reason. A plain bloom pass can only sort by
 * luminance, and luminance does not know the difference between a lamp and a
 * cheek in full moonlight: raise the threshold until faces stop glowing and
 * the lamps stop glowing too. A layer sorts by intent instead. The effect
 * renders that layer and nothing else, so what blooms is decided by you rather
 * than by a threshold you keep re-tuning.
 *
 * The same trick works for selective lighting, which is a separate mechanism
 * with the same vocabulary: a light illuminates an object only when
 * `light.layers.test(object.layers)` passes. Put a light alone on a layer and
 * enable that layer on a few meshes, and it lights those meshes only.
 *
 * Layers are per-object and are NOT inherited, which is the part that trips
 * people up: enabling a layer on a group does nothing for its children. Hence
 * the traversal here.
 *
 * @param {import('three').Object3D | null | undefined} target Root of the subtree.
 * @param {number} layer Layer index, 0 to 31. Layer 0 is where everything already is.
 * @param {boolean} [enabled=true]
 *
 * @example
 * const [wolf, setWolf] = useState(null);
 * useSelectionLayer(wolf, BLOOM_LAYER);
 * // ...
 * <primitive object={model} ref={setWolf} />
 * <SelectiveBloom selectionLayer={BLOOM_LAYER} luminanceThreshold={0.6} />
 */
export function useSelectionLayer(target, layer, enabled = true) {
  useEffect(() => {
    if (!target || !enabled) return undefined;

    // Only renderables matter: a light or a bone carrying the layer changes
    // nothing, and collecting them would make the cleanup lie about its scope.
    const touched = [];
    target.traverse((node) => {
      if (node.isMesh || node.isPoints || node.isLine || node.isSprite) {
        node.layers.enable(layer);
        touched.push(node);
      }
    });

    // Cleanup matters more than it looks. Models are routinely cloned from a
    // cached glTF, and a clone can share nothing but still be swapped in and
    // out as the user changes character. Leaving the layer set on a node that
    // has left the selection makes it bloom forever, with no visible cause.
    return () => {
      for (const node of touched) node.layers.disable(layer);
    };
  }, [target, layer, enabled]);
}
