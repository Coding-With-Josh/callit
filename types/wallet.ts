/**
 * wallet — pure Solana address validation.
 *
 * Owns: base58 decoding and an exact 32-byte public-key length check.
 * Uses only pure functions: no network, no `@solana/web3.js`.
 * Must not import: any other module in this package (keeps the dependency
 * direction one-way and makes import cycles impossible).
 *
 * The check is structural (decodes to exactly 32 bytes), which is what a
 * Solana public key is. It does not prove the key is on-curve; that needs
 * Ed25519 math and is intentionally out of scope for the contract.
 */

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const BASE58_INDEX: ReadonlyMap<string, number> = new Map(
  Array.from(BASE58_ALPHABET).map((ch, i) => [ch, i] as const),
);

const BASE58_RADIX = BigInt(58);
const BYTE_RADIX = BigInt(256);

/** Convert a non-negative bigint to big-endian bytes (no bigint literals: ES2017 target). */
function bigIntToBytes(value: bigint): Uint8Array {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > BigInt(0)) {
    bytes.push(Number(remaining % BYTE_RADIX));
    remaining = remaining / BYTE_RADIX;
  }
  bytes.reverse();
  return Uint8Array.from(bytes);
}

/**
 * Decode a base58 string to bytes, or return null when the input contains a
 * character outside the base58 alphabet. Leading '1' characters decode to
 * leading zero bytes — that is the correct edge case, not an error, and it is
 * why a plain string-length check is insufficient on its own.
 */
export function base58Decode(input: string): Uint8Array | null {
  if (input.length === 0) return null;

  let leadingZeros = 0;
  while (leadingZeros < input.length && input[leadingZeros] === '1') {
    leadingZeros += 1;
  }

  let value = BigInt(0);
  for (let i = leadingZeros; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === undefined) return null;
    const digit = BASE58_INDEX.get(ch);
    if (digit === undefined) return null;
    value = value * BASE58_RADIX + BigInt(digit);
  }

  const body = value === BigInt(0) ? new Uint8Array(0) : bigIntToBytes(value);
  const out = new Uint8Array(leadingZeros + body.length);
  out.set(body, leadingZeros);
  return out;
}

/** True only when `input` decodes to exactly 32 bytes. */
export function isValidSolanaAddress(input: string): boolean {
  const decoded = base58Decode(input);
  return decoded !== null && decoded.length === 32;
}
