import type { FloatType, HalfFloatType, Uniform } from 'three'

export type Callable = (...args: unknown[]) => unknown

export type UniformMap<T> = Omit<Map<string, Uniform>, 'get'> & {
  get: <K extends keyof T>(key: K) => T[K]
  set: <K extends keyof T>(key: K, value: T[K]) => void
}

export type AnyFloatType = typeof FloatType | typeof HalfFloatType

export function reinterpretType<T>(value: unknown): asserts value is T {
  void value
}
