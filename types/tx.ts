/**
 * tx — transaction-carrying types.
 *
 * Owns: the branded UnsignedTransactionB64, the opaque PantaTransaction brand,
 * the signer-check type, and pure signer collection.
 * Must not import: any framework. It re-exports the wire RawInstruction type so
 * downstream code has one import for transaction data.
 *
 * HARD RULE (fail-closed): a PantaTransaction is opaque. Downstream code must
 * never add or remove instructions or accounts. We only compile the bytes Panta
 * gave us into a transaction, let the user sign, and broadcast.
 */
import { z } from 'zod';
import type { RawInstruction } from './panta-wire/common';
import type { WalletAddress } from './ids';

/** A base64-encoded unsigned versioned transaction. */
export const unsignedTransactionB64Schema = z
  .string()
  .min(1)
  .brand<'UnsignedTransactionB64'>();
export type UnsignedTransactionB64 = z.infer<
  typeof unsignedTransactionB64Schema
>;

/** A Panta-authored transaction we treat as opaque and unmodifiable. */
export const pantaTransactionSchema =
  unsignedTransactionB64Schema.brand<'PantaTransaction'>();
export type PantaTransaction = z.infer<typeof pantaTransactionSchema>;

/** Re-export of the wire instruction type, for transaction consumers. */
export type { RawInstruction };

/**
 * A documented, checked view of who must sign a set of instructions. If
 * `onlyUserSigns` is false, the transaction needs a signer other than the user
 * — a risk that must be surfaced, never silently signed.
 */
export interface SignerCheck {
  readonly userWallet: WalletAddress;
  readonly signers: readonly string[];
  readonly unexpectedSigners: readonly string[];
  readonly onlyUserSigns: boolean;
}

/** Pure: collect the distinct required signer pubkeys from instructions. */
export function collectSigners(
  instructions: readonly RawInstruction[],
): readonly string[] {
  const signers = new Set<string>();
  for (const instruction of instructions) {
    for (const account of instruction.accounts) {
      if (account.isSigner) signers.add(account.pubkey);
    }
  }
  return [...signers];
}

/** Pure: build the signer check for a user wallet. Never signs; only reports. */
export function signerCheck(
  instructions: readonly RawInstruction[],
  userWallet: WalletAddress,
): SignerCheck {
  const signers = collectSigners(instructions);
  const unexpectedSigners = signers.filter(
    (signer) => signer !== userWallet,
  );
  return {
    userWallet,
    signers,
    unexpectedSigners,
    onlyUserSigns:
      unexpectedSigners.length === 0 && signers.length <= 1,
  };
}
