/** Rendering-independent motion decisions. Coordinates use one shared space. */
export interface Bounds { x: number; y: number; width: number; height: number }
export interface IdentityPosition { id: string; bounds: Bounds }
export interface Translation { id: string; x: number; y: number; duration: number }
export interface MovementOptions { duration: number; enabled: boolean; minimum?: number }

/** Card travel geometry, independent of card kinds and browser elements. */
export function flightOffset(from: Bounds, to: Bounds) {
  return {
    x: from.x + from.width / 2 - to.x - to.width / 2,
    y: from.y + from.height / 2 - to.y - to.height / 2,
    scale: to.width > 0 ? Math.min(1.6, Math.max(.4, from.width / to.width)) : 1,
  };
}

/** Join by identity, never by seat: a seat can acquire a different occupant. */
export function planMovement(before: readonly IdentityPosition[], after: readonly IdentityPosition[], options: MovementOptions): Translation[] {
  if (!options.enabled || options.duration <= 0) return [];
  const previous = new Map(before.map(position => [position.id, position.bounds]));
  return after.flatMap(({ id, bounds }) => {
    const old = previous.get(id);
    if (!old || old.width <= 0 || bounds.width <= 0) return [];
    const { x, y } = flightOffset(old, bounds);
    if (Math.hypot(x, y) < (options.minimum ?? 2)) return [];
    return [{ id, x, y, duration: options.duration }];
  });
}
