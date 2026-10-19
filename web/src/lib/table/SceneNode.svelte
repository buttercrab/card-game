<script lang="ts">
  import { onDestroy, tick, type Snippet } from 'svelte';
  import type { Bounds } from './movement';
  import { SceneMotion, type MotionPose } from './sceneMotion';
  import { tableCoordinates } from './coordinateContext';
  let { id, bounds, children, duration = 220, enabled = true, z = 0 }: { id: string; bounds: Bounds; children: Snippet; duration?: number; enabled?: boolean; z?: number } = $props();
  let element: HTMLDivElement;
  let previous: Bounds | null = null;
  let previousId: string | null = null;
  let sequence = 0;
  let disposed = false;
  let pendingId: string | null = null;
  let pendingPose: MotionPose | null = null;
  let pendingIdentityChange = false;
  const movement = new SceneMotion();
  const coordinates = tableCoordinates();
  let initialLayoutReady = $state(!coordinates);
  $effect(() => coordinates?.measurements.observeReady(ready => { initialLayoutReady = ready; }));
  $effect.pre(() => {
    const next = { ...bounds }, key = id, allowed = enabled && initialLayoutReady, ms = duration;
    if (!allowed || ms <= 0) { sequence++; movement.interrupt(); pendingId = null; pendingPose = null; }
    const old = previous, same = previousId === key;
    previous = next; previousId = key;
    if (old && same && old.x === next.x && old.y === next.y && old.width === next.width && old.height === next.height) return;
    // Capturing computed style can force browser layout. Neither unchanged
    // destinations nor disabled movement need an animation starting pose.
    if (!allowed || ms <= 0) return;
    // Synchronous layout settling may produce several destinations before
    // tick resolves. Keep the first displayed pose and target only the last.
    if (pendingId !== key) {
      pendingId = key;
      pendingIdentityChange = !same;
      pendingPose = same && old && element ? movement.capture(key, element, old) : null;
    }
    const current = ++sequence;
    void tick().then(() => {
      if (disposed || current !== sequence || !enabled || duration <= 0) return;
      const pose = pendingPose;
      const identityChanged = pendingIdentityChange;
      pendingId = null; pendingPose = null;
      if (identityChanged) movement.interrupt();
      if (pose) void movement.retarget(key, element, pose, next, { duration: ms, enabled: allowed, animationId: 'scene-node' });
    });
  });
  onDestroy(() => { disposed = true; sequence++; pendingId = null; pendingPose = null; movement.dispose(); });
</script>
<div bind:this={element} data-coordinate-id={id} style:position="absolute" style:left={`${bounds.x}px`} style:top={`${bounds.y}px`} style:width={`${bounds.width}px`} style:height={`${bounds.height}px`} style:z-index={z} style:transform-origin="50% 50%">
  {@render children()}
</div>
