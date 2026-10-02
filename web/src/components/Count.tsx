/** A figure shown exactly as formatted (kept as a component so every figure has one place to change). */
export function Count({ value, format }: { value: number; format: (n: number) => string }) {
  return <span>{format(value)}</span>
}
