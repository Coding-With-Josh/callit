/**
 * solana/assemble — compile Panta's raw instructions into an unsigned wire
 * transaction a Blink client can hand to a wallet.
 *
 * Owns: mapping `RawInstruction[]` + a blockhash into a version-0
 * `VersionedTransaction`, and the fail-closed gates that make that safe.
 * Must not import: React, Next, or any UI module. Runs in Node.
 *
 * HARD RULE (types/tx.ts): the instructions are Panta's and are opaque. This
 * module consumes them verbatim — it never adds, removes or reorders an
 * instruction, and never injects a memo/attribution instruction of our own.
 *
 * Why the gates matter (Phase 3): the POST that calls this is unauthenticated
 * and cross-origin, and the returned bytes are signed by a stranger's wallet.
 * Three things are asserted before the bytes are returned:
 *   1. Signer substitution / multi-sig laundering — the raw instructions must
 *      require EXACTLY ONE signer and it must be the request's `account`. With
 *      N > 1 required signers a single user signature could be laundered into a
 *      transaction the user did not fully see. (`signerCheck`, from types/tx.)
 *   2. Instruction injection — every program id and account pubkey is an address
 *      (never a name/label), and every data field is well-formed base64. A
 *      malformed row fails closed rather than compiling to garbage.
 *   3. TOCTOU between "assemble" and "sign" — after compiling we re-decode the
 *      final bytes through the same single-signer gate the web signer uses
 *      (lib/solana/sign), so what the wallet is asked to sign is byte-for-byte
 *      what we validated, not an intermediate message we hoped compiled the same.
 *
 * @solana/kit 8.4.0 API notes: `assertIsAddress`/`assertIsBlockhash` are
 * assertion functions (void, they narrow), so values are routed through local
 * helpers; the blockhash lifetime object requires `BigInt(...)` rather than a
 * `10n` literal (ES2017 target); `createTransactionMessage` takes
 * `{version:0}`; the message is built by piping transforms (`pipe`), because
 * reassigning the result of each transform back onto one `let` does not
 * typecheck — every transform narrows the message brand.
 */
import {
  AccountRole,
  appendTransactionMessageInstructions,
  assertIsAddress,
  assertIsBlockhash,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type AccountMeta,
  type Address,
  type Blockhash,
  type Instruction,
} from '@solana/kit';
import {
  err,
  ok,
  signerCheck,
  type PantaTransaction,
  type RawInstruction,
  type Result,
  type WalletAddress,
} from '@/types';
import { decodeUnsignedTransactionB64, getSingleRequiredSigner } from './sign';

/** Why a set of Panta instructions could not be safely compiled. */
export type AssembleError =
  | { readonly kind: 'invalid-fee-payer'; readonly message: string }
  | { readonly kind: 'invalid-blockhash'; readonly message: string }
  | { readonly kind: 'invalid-block-height'; readonly message: string }
  | { readonly kind: 'empty-instructions' }
  | { readonly kind: 'unexpected-signers'; readonly signers: readonly string[] }
  | { readonly kind: 'invalid-instruction'; readonly message: string }
  | { readonly kind: 'encode-failed'; readonly message: string }
  | { readonly kind: 'signer-mismatch'; readonly message: string };

export interface AssembleInput {
  /** The wallet the client sent as `account`. Already validated as an address. */
  readonly feePayer: WalletAddress;
  readonly instructions: readonly RawInstruction[];
  readonly recentBlockhash: string;
  readonly lastValidBlockHeight: number;
}

/** Base64 alphabet with optional padding (instruction `data` uses this). */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Decode an instruction's base64 `data`, or null when it is not valid base64. */
function decodeInstructionData(data: string): Uint8Array | null {
  if (data.length === 0) return new Uint8Array(0);
  // A length ≡ 1 (mod 4) cannot be base64; the regex rejects every character
  // outside the alphabet. Both checks are explicit so rejection is deterministic
  // even if the underlying codec were lenient.
  if (data.length % 4 === 1 || !BASE64_RE.test(data)) return null;
  try {
    return new Uint8Array(getBase64Encoder().encode(data));
  } catch {
    return null;
  }
}

/** Map Panta's `{isSigner,isWritable}` to a Solana account role. */
function accountRole(isSigner: boolean, isWritable: boolean): AccountRole {
  if (isSigner) {
    return isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER;
  }
  return isWritable ? AccountRole.WRITABLE : AccountRole.READONLY;
}

/** Assert + narrow a raw string to `Address` (assertion functions return void). */
function toAddress(raw: string): Address {
  assertIsAddress(raw);
  return raw as Address;
}

/**
 * Compile Panta's instructions into an unsigned base64 wire transaction whose
 * only required signer is `input.feePayer`. Total: every failure is a typed
 * `AssembleError`, never a throw.
 */
export function assembleUnsignedTransaction(
  input: AssembleInput,
): Result<PantaTransaction, AssembleError> {
  // Gate 1: the fee payer must be a real address. A bad one would compile into
  // a transaction no wallet can sign (Phase 2: fail closed, not a broken tx).
  let feePayer: Address;
  try {
    feePayer = toAddress(input.feePayer);
  } catch {
    return err({
      kind: 'invalid-fee-payer',
      message: 'account is not a valid Solana address',
    });
  }

  // Gate 2: the blockhash must be structurally valid before it is baked into a
  // lifetime the wallet will trust.
  let blockhash: Blockhash;
  try {
    assertIsBlockhash(input.recentBlockhash);
    blockhash = input.recentBlockhash as Blockhash;
  } catch {
    return err({
      kind: 'invalid-blockhash',
      message: 'Panta returned a malformed blockhash',
    });
  }

  if (!Number.isSafeInteger(input.lastValidBlockHeight) || input.lastValidBlockHeight < 0) {
    return err({
      kind: 'invalid-block-height',
      message: 'Panta returned an invalid lastValidBlockHeight',
    });
  }

  if (input.instructions.length === 0) {
    // Nothing to sign — never hand a wallet an empty transaction (the create
    // adapter refuses this for the same reason).
    return err({ kind: 'empty-instructions' });
  }

  // Gate 3: EXACTLY ONE required signer, and it must be the request account.
  // Phase 3 (multi-sig laundering): this is the check that stops the user's
  // single signature from being reused as one of several signers on instructions
  // they cannot see. It runs on Panta's raw rows, before anything is compiled.
  const check = signerCheck(input.instructions, input.feePayer);
  if (!check.onlyUserSigns || check.signers.length !== 1) {
    return err({ kind: 'unexpected-signers', signers: check.signers });
  }

  // Gate 4: map each row, validating every address and data blob. Any malformed
  // row fails the whole assembly (fail closed) rather than being skipped.
  const instructions: Instruction[] = [];
  for (const raw of input.instructions) {
    let programAddress: Address;
    try {
      programAddress = toAddress(raw.programId);
    } catch {
      return err({
        kind: 'invalid-instruction',
        message: 'instruction programId is not a valid address',
      });
    }
    const data = decodeInstructionData(raw.data);
    if (data === null) {
      return err({
        kind: 'invalid-instruction',
        message: 'instruction data is not valid base64',
      });
    }
    const accounts: AccountMeta[] = [];
    for (const account of raw.accounts) {
      let address: Address;
      try {
        address = toAddress(account.pubkey);
      } catch {
        return err({
          kind: 'invalid-instruction',
          message: 'instruction account is not a valid address',
        });
      }
      accounts.push({
        address,
        role: accountRole(account.isSigner, account.isWritable),
      });
    }
    instructions.push({ programAddress, accounts, data });
  }

  // Compile. No instruction is added here — `instructions` (built by the loop
  // above) is the only writer. `pipe` threads each step's output straight into
  // the next transform, which is what keeps the transaction-message type intact:
  // reassigning `let message = fn(message)` would fail to typecheck because every
  // kit transform narrows the message brand and the result is not assignable
  // back to the raw `EmptyTransactionMessage` (observed during slice-1 typecheck).
  let b64: string;
  try {
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(feePayer, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash, lastValidBlockHeight: BigInt(input.lastValidBlockHeight) },
          m,
        ),
    );
    b64 = getBase64EncodedWireTransaction(compileTransaction(message));
  } catch {
    return err({
      kind: 'encode-failed',
      message: 'transaction could not be compiled',
    });
  }

  // Gate 5 (Phase 3: TOCTOU check-and-use): re-decode the exact bytes we are
  // about to return, through the same single-signer gate the web signer uses.
  // If the compiled bytes do not require exactly the fee payer as their only
  // signer, the client would be asked to sign something we did not validate.
  let compiledSigner: string;
  try {
    compiledSigner = getSingleRequiredSigner(decodeUnsignedTransactionB64(b64));
  } catch {
    return err({
      kind: 'signer-mismatch',
      message: 'compiled transaction does not require exactly one signer',
    });
  }
  if (compiledSigner !== feePayer) {
    return err({
      kind: 'signer-mismatch',
      message: 'compiled transaction signer is not the requesting account',
    });
  }

  // The brand asserts "these bytes are Panta's, unmodified" — which is what the
  // loop above guarantees. Cast records that, it does not confer it.
  return ok(b64 as PantaTransaction);
}
