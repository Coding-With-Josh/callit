/**
 * Hidden dev route — REAL external-wallet signing smoke test. Not linked from UI.
 *
 * Replaces the old setTimeout stub. Builds a minimal self-transfer transaction
 * (1 lamport, payer = the linked wallet), serializes it to Panta's base64 wire
 * format, then signs it through the real path (use-solana-signer -> Privy
 * standard wallet -> the user's external wallet), and shows the resulting
 * base58 signature. Nothing is broadcast.
 *
 * The self-transfer keeps the signer gate happy: exactly one required signer
 * (the fee payer == the wallet being prompted), so this exercises the exact
 * pipeline the create/buy adapters will use.
 *
 * @solana/kit 8.4.0 API notes: `assertIsAddress`/`assertIsBlockhash` are
 * assertion functions (they return void and narrow), so every value passes
 * through the local `toAddress`/`BLOCKHASH` helpers below; the lifetime object
 * form requires a `bigint` (`BigInt(0)` rather than the `0n` literal, which
 * needs an ES2020 TS target this repo does not set); `createTransactionMessage`
 * takes `{ version: 0 }`.
 */
'use client';

import { useState } from 'react';
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
import { WalletPill } from '@/components/auth/wallet-pill';
import { useSolanaSigner } from '@/components/auth/use-solana-signer';

/** Assert + narrow a raw string to `Address` (assertion functions return void). */
function toAddress(raw: string): Address {
  assertIsAddress(raw);
  return raw as Address;
}

/**
 * Deterministic, structurally-valid dummy recent blockhash (a real-looking
 * base58 32-byte string). Signing does not require network state; broadcasting
 * would, so the placeholder is fine for the smoke test.
 */
const BLOCKHASH: Blockhash = (() => {
  const raw = '3Jp9C1tKrLdD9r2RQZoTNLKgrT5v9ZxCTAiF9HXhDD3F';
  assertIsBlockhash(raw);
  return raw as Blockhash;
})();

/**
 * Build a base64 wire transaction that transfers 1 lamport from `wallet` to
 * itself (a no-op balance-wise) with the wallet as the only required signer.
 */
function buildSelfTransferB64(walletAddr: string): string {
  const payer = toAddress(walletAddr);
  // System program transfer: discriminator 2 (u32 LE), lamports 1 (u64 LE).
  // Byte literal (no BigInt literal — ES2020 target constraint).
  const data = new Uint8Array([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);

  const instruction: Instruction = {
    programAddress: toAddress('11111111111111111111111111111111'),
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER }, // from (signs)
      { address: payer, role: AccountRole.READONLY }, // to
    ],
    data,
  };

  const message = createTransactionMessage({ version: 0 });
  const withPayer = setTransactionMessageFeePayer(payer, message);
  const withInstruction = appendTransactionMessageInstruction(instruction, withPayer);
  const withLifetime = setTransactionMessageLifetimeUsingBlockhash(
    { blockhash: BLOCKHASH, lastValidBlockHeight: BigInt(0) },
    withInstruction,
  );
  return getBase64EncodedWireTransaction(compileTransaction(withLifetime));
}

function shortSig(sig: string): string {
  if (sig.length <= 16) return sig;
  return `${sig.slice(0, 8)}…${sig.slice(-8)}`;
}

export default function DevPage() {
  const { wallet, connectedAddress, ready, sign } = useSolanaSigner();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSign = async () => {
    setResult(null);
    setError(null);
    if (!wallet) {
      setError('No linked Solana wallet — link one from the wallet pill.');
      return;
    }
    setBusy(true);
    try {
      const b64 = buildSelfTransferB64(wallet);
      const out = await sign(b64);
      if (out.ok) {
        setResult(
          `Signed ${shortSig(out.value.signature)} for ${wallet.slice(0, 6)}… (mainnet chain)`,
        );
      } else {
        setError(describeError(out.error));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center bg-[#FFF2DD] px-6 pt-40">
      <div className="w-full max-w-xl text-center">
        <h1 className="font-tusker-9800 text-3xl text-[#2D1C00] md:text-4xl">
          Dev: wallet signing
        </h1>
        <p className="mt-3 text-sm tracking-tight text-[#2D1C00]/70">
          Hidden route. Not linked from UI. Signs a 1-lamport self-transfer with
          your own wallet — nothing is broadcast.
        </p>
        <div className="mt-8 flex flex-col items-center gap-4">
          <WalletPill />
          <p className="font-mono text-xs text-[#2D1C00]/60">
            identity: {wallet ? `${wallet.slice(0, 6)}…` : 'none'} · connected:{' '}
            {connectedAddress ? `${connectedAddress.slice(0, 6)}…` : 'none'}
          </p>
          <button
            type="button"
            disabled={busy || !ready}
            onClick={handleSign}
            className="rounded-full bg-[#2D1C00] px-6 py-2.5 text-sm font-semibold tracking-tight text-[#FFF2DD] transition hover:scale-102 active:scale-98 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Signing…' : 'Sign self-transfer (real)'}
          </button>
          {result && (
            <p className="mt-2 font-mono text-xs text-[#2D1C00]/70">{result}</p>
          )}
          {error && (
            <p className="mt-2 font-mono text-xs text-red-800">{error}</p>
          )}
        </div>
      </div>
    </main>
  );
}

function describeError(e: {
  kind: string;
  numRequiredSignatures?: number;
  txSigner?: string;
  expected?: string;
  message?: string;
}): string {
  switch (e.kind) {
    case 'unauthenticated':
      return 'Not authenticated.';
    case 'no-wallet':
      return 'No connected wallet for this identity.';
    case 'decode-failed':
      return 'Transaction payload could not be decoded.';
    case 'not-single-signer':
      return `Refusing: transaction requires ${e.numRequiredSignatures} signers, expected 1.`;
    case 'signer-mismatch':
      return 'Refusing: transaction signer is not your wallet.';
    case 'wallet-rejected':
      return `Wallet error: ${e.message ?? 'unknown'}`;
    default:
      return 'Signing failed.';
  }
}