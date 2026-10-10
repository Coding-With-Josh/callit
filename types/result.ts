/**
 * result — an explicit success/failure union for flows where failure is
 * expected control flow (parsing, validation, adapters).
 *
 * Owns: Result<T, E> and its pure constructors/guards.
 * Must not import: anything. This module has zero dependencies.
 */

/** Success or failure, with the failure value typed rather than thrown. */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Wrap a success value. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Wrap a failure value. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Narrow a Result to its success branch. */
export function isOk<T, E>(
  result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

/** Narrow a Result to its failure branch. */
export function isErr<T, E>(
  result: Result<T, E>,
): result is { readonly ok: false; readonly error: E } {
  return !result.ok;
}

/** Map the success value while preserving the failure. */
export function mapResult<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : err(result.error);
}

/** Return the success value, or a fallback when the Result failed. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
