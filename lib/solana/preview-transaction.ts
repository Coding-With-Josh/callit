/**
 * solana/preview-transaction — a real, signable transaction for the sign-only
 * preview surfaces (the /dev smoke test and the create wizard's sign step).
 *
 * Owns: building a 1-lamport self-transfer (payer -> itself) with a
 * deterministic dummy blockhash, serialized to the base64 wire form the signer
 * gate consumes.
 * Must not: sign, broadcast, or hold a key.
 *
 * Phase 1 (complete mediation): this module produces bytes only. The gate that
 * decides whether those bytes may be shown to a wallet lives in
 * components/auth/use-solana-signer, which re-decodes whatever it is handed and
 * refuses unless the single required signer is the session identity wallet.
 *
 * Phase 2 (no accidental value transfer): the blockhash below is a fixed
 * placeholder, not a real recent blockhash, so the compiled transaction is not
 * broadcastable; the transfer is 1 lamport from the payer back to the payer.
 * Nothing here can move funds even if something later tried to send it.
 *
 * @solana/kit 8.4.0 API notes: `assertIsAddress`/`assertIsBlockhash` are
 * assertion functions (they return void and narrow), so every value passes
 * through `toAddress`/the IIFE below; the lifetime object form requires a
 * `bigint` (`BigInt(0)` rather than the `0n` literal, which needs an ES2020 TS
 * target this repo does not set); `createTransactionMessage` takes `{ version: 0 }`.
 */
import {
  AccountRole,
  appendTransactionMessageInstruction,
  assertIsAddress,
  assertIsBlockhash,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from '@solana/kit';

/** Assert + narrow a raw string to `Address` (assertion functions return void). */
function toAddress(raw: string): Address {
  assertIsAddress(raw);
  return raw as Address;
}

/**
 * Deterministic, structurally-valid dummy recent blockhash (a real-looking
 * base58 32-byte string). Signing needs no network state; broadcasting would,
 * so a placeholder is fine — and preferable, because it makes the built
 * transaction unbroadcastable.
 */
const BLOCKHASH: Blockhash = (() => {
  const raw = '3Jp9C1tKrLdD9r2RQZoTNLKgrT5v9ZxCTAiF9HXhDD3F';
  assertIsBlockhash(raw);
  return raw as Blockhash;
})();

/** The System program — the only program this preview transaction invokes. */
const SYSTEM_PROGRAM: Address = toAddress('11111111111111111111111111111111');

/**
 * System `Transfer` instruction data: u32 LE instruction index (2) followed by
 * u64 LE lamports (1). A byte literal — no BigInt literal (ES2020 target).
 */
const TRANSFER_ONE_LAMPORT = new Uint8Array([
  2, 0, 0, 0, // u32 LE: SystemInstruction::Transfer
  1, 0, 0, 0, 0, 0, 0, 0, // u64 LE: 1 lamport
]);

/**
 * Build a base64 wire transaction that transfers 1 lamport from `feePayer` to
 * itself, with `feePayer` as the only required signer.
 *
 * Throws only when `feePayer` is not a valid Solana address (callers pass the
 * already-validated session wallet); the signer gate would reject anything
 * malformed anyway, so a throw here fails closed rather than prompting.
 */
export function buildPreviewSelfTransferB64(feePayer: string): string {
  const payer = toAddress(feePayer);

  const instruction: Instruction = {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER }, // from (signs)
      { address: payer, role: AccountRole.READONLY }, // to
    ],
    data: TRANSFER_ONE_LAMPORT,
  };

  const message = createTransactionMessage({ version: 0 });
  const withPayer = setTransactionMessageFeePayer(payer, message);
  const withInstruction = appendTransactionMessageInstruction(
    instruction,
    withPayer,
  );
  const withLifetime = setTransactionMessageLifetimeUsingBlockhash(
    { blockhash: BLOCKHASH, lastValidBlockHeight: BigInt(0) },
    withInstruction,
  );
  return getBase64EncodedWireTransaction(compileTransaction(withLifetime));
}
