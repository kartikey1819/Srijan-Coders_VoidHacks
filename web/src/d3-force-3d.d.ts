declare module 'd3-force-3d' {
  interface RadialForce {
    (alpha: number): void
    strength(s: number): RadialForce
    radius(r: number): RadialForce
  }
  export function forceRadial(radius: number, x?: number, y?: number, z?: number): RadialForce
}
