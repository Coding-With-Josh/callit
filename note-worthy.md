# note-worthy — Blink integration notes

> Working notes on integrating Solana Blinks (Solana Actions) into Callit.
> Captured 2026-10-11 from the readiness review + design conversation.
> Status: **assessment done, no code written yet.** The scope fork at the
> bottom is still open — it decides everything downstream.

---

## 1. Readiness verdict (the short version)

**Contracts: unusually ready. Runtime a Blink actually needs: mostly absent.**

The foundation was designed with Blinks in mind — `types/blink.ts` exists,
`APP_REGISTRY` already registers a `blink` app with scoped operations and a rate
budget, attribution already supports the `blink` surface, and the market-read
path + wallet validation + tx brands are all built. But a Blink that lets
someone *back YES/NO* is, mechanically, the **buy pipeline**, and that pipeline
does not exist yet. Production Blinks are therefore blocked.

### What already exists

| Layer a Blink needs | State | Evidence |
|---|---|---|
| Blink wire contract (GET/POST/callback/error) | Exists (~70%), unused | `types/blink.ts` |
| App/surface registration + attribution | Exists | `types/app-registry.ts` (`blink` entry, budget reads:20/quotes:5/builds:5), `types/attribution.ts` (surface `'blink'`) |
| Market read for GET metadata | Exists | `lib/panta/read-adapters.ts`, `lib/panta/catalog.ts` |
| Wallet-address validation (untrusted `account`) | Exists | `types/wallet.ts`, `types/ids.ts` |
| Opaque-tx brand + signer check | Exists | `types/tx.ts` |
| Identity/session (Privy, signed cookie) | Exists | `lib/auth/*` — NOT used by Blinks (they're wallet-signed, not session-signed) |

### The five hard blockers (dependency order)

1. **No buy pipeline.** No `lib/panta/buy-adapters.ts` (build.md P6 `[ ]`).
   A transaction Blink's POST must call quote→build; there is nothing to call.
2. **No transaction assembly.** Panta's `/primaryorderbuild/` returns
   `instructions[] + recentBlockhash + lastValidBlockHeight`, not a base64 tx.
   A Blink POST must return a compiled **unsigned** `VersionedTransaction` with
   the request's `account` as fee payer. No compiler exists. `@solana/kit` is a
   dependency but is imported nowhere (grep: 0 hits).
3. **No `actions.json`, no action routes, no CORS.** The spec requires explicit
   OPTIONS preflight + `Access-Control-Allow-Origin: *` (no credentials) +
   `Access-Control-Allow-Methods/Headers` + `Access-Control-Expose-Headers`,
   plus response headers `X-Action-Version` and
   `X-Blockchain-Ids: solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (mainnet
   genesis). A static `public/actions.json` won't carry CORS — needs a route
   handler or a `headers()` rule.
4. **No ledger / trade report / DB / reconciler.** `types/ledger.ts` and
   `types/panta-wire/trades.ts` exist; no `lib/ledger`, no DB client
   (`DATABASE_URL` set but unused), no `POST /trades/` adapter, no reconciler.
5. **No RPC / confirmation path.** `SOLANA_RPC_URL` is read but never used.
   ⚠️ `types/env.ts:47` defaults it to `api.devnet.solana.com` while the
   product is **mainnet-only** — a live footgun if any route reads that default.

Supporting gaps (not hard blockers): no rate-budget enforcement for the public
blink endpoints (a hostile client can drain the shared Panta 120/60/30/20 key
budget); no cache layer (GET metadata re-hits Panta per render under
`cacheComponents`); `NEXT_PUBLIC_APP_URL` is in the env schema but consumed
nowhere (needed for absolute `icon`, `actions.json` hrefs, callback URL);
no compliance enforcement of the exact `Powered by Panta` badge in the Blink
title/description.

---

## 2. How a Blink actually works (the flow)

It does **not** take the user to callit. Callit's website is not in the loop.
A Blink is just a URL that different clients render as a card.

1. **The card appears.** Someone posts a `callit.app/blink/<marketId>` link on
   X. Because the domain is registered with Dialect's registry, X renders the
   card — icon, title, description, buttons ("Back YES", "Back NO") — from a
   `GET` call to our server. Metadata only; no wallet involved.
2. **The user taps a button.** The client (X, Phantom, Backpack, Solflare, …)
   does a `POST` to our server with `{ account: "<wallet address>" }`. Our
   server calls Panta for a live quote + build, compiles them into an
   **unsigned transaction**, and returns it.
3. **The user's wallet signs.** The unsigned transaction is handed to *their*
   wallet (extension popup, or deep-linked wallet app). The user approves; the
   wallet signs AND broadcasts to Solana. Callit never sees the private key.
4. **The callback.** After confirmation, the wallet POSTs
   `{ account, signature }` back to `links.next` so we can record the trade and
   report it to Panta for attribution.

So: X → wallet → approve → sign → Solana. Callit's server only ever *builds*
the transaction and *records the result*. No callit login screen, no callit
page confirming anything.

Nuance: on desktop X, tapping a Blink button opens the wallet-connection flow
(Dialect's picker or the extension popup if no wallet is connected). In a
wallet app the card renders natively. Either way it's the user's wallet doing
the work.

---

## 3. The callback, explained

**Mechanism.** The Blink POST response includes `links.next` — a contract blurb
"when you're done, POST the result here". The Solana Actions spec says the
client, after the tx confirms on-chain, POSTs back to `links.next.href`:

```json
{ "account": "<the wallet that signed>", "signature": "<the tx signature>" }
```

No market id, no order id — just wallet + signature. **The signature is the
only key**, so our server must have saved the pending order earlier (at the
build step: orderId, quoteId, marketId, side, amount, fee, account) to
correlate them. Unknown signature → rejected. This maps exactly to the
`built → submitted → reported` row lifecycle in `types/ledger.ts`.

**What the server does with the callback (in order):**

1. **Shape-check**: account is a valid Solana address; signature is base58.
   Garbage in, rejected out.
2. **Verify on-chain** (security-critical): ask the RPC — does the signature
   exist? did the tx succeed? did it invoke the expected program? was the
   signer the reported account? A well-behaved wallet only fires the callback
   *after* confirmation, so this usually passes instantly — but it's what stops
   someone from POSTing a made-up signature to pollute volume stats.
3. **Report to Panta**: `POST /trades/` with signature, wallet, market id,
   quote id, attribution tag `callit:v1:blink:blink`. This is what makes the
   trade count as *blink-attributed volume*. Idempotent per signature.
4. **Write the ledger row** — idempotently, keyed on the signature.
5. **Answer the wallet** — a non-error response lets the client show
   "Backed YES ✓".

**The catch.** Not every wallet client implements the chained callback (Dialect
flags this; build.md lists it as an open question). The architecture cannot
*depend* on it: the **reconciler** (background job scanning on-chain for
signatures we issued but never heard back about) is the safety net. Callback =
fast path; reconciler = fallback. If the callback never fires, the buy still
gets reported; if the reconciler finds the signature didn't confirm, nothing is
reported as volume.

---

## 4. Does the Blink buyer need the same wallet as their callit login?

**Technically: no, and nothing forces it.** A Blink is a public URL with no
session. Anyone with *any* Solana wallet can tap "Back YES"; we never check
"is this the wallet that logged into callit". Buying via Blink is, in the
protocol's eyes, just *some wallet buying a market*.

**Practically it matters:**

- **Positions and claims are per-wallet, not per-person.** Shares accrue to the
  wallet that signed. If a user buys on callit web with wallet A and via Blink
  with wallet B, they get two piles of shares and two claim paths. Creator fees
  and win claims follow the *holding* wallet.
- **The embedded-wallet trap.** Logging in via email/Google with Privy can mint
  an **embedded Solana wallet** — a keypair inside our web app's Privy session,
  *browser-bound*. It's not present on X. X hands the tx to whatever external
  wallet the person has (Phantom…). Embedded wallet + Phantom = two wallets,
  two positions.
- **Stats attribution is per-wallet too.** A wallet buying via web and blink
  shows under both surfaces (correct), but reconciling "who is this human"
  across wallets is a separate problem.

**Product guidance:** tell users *"use one wallet everywhere"* — the wallet IS
the identity in this product; the cleanest way to keep positions, claims, and
activity in one place is to never split buys across wallets. If we want to let
people unify (buy on X with Phantom, still see it under their callit account),
the right tool is **linking** — Privy supports attaching an external wallet to
the same account. That surface isn't built yet, and merging positions would be a
product decision (the shares themselves live on whichever wallet holds them).

---

## 5. Attack surface to design against (when we build)

| Vector | Concrete scenario | Closing construct (planned) |
|---|---|---|
| **Callback forgery / fake volume** | Anyone POSTs `{account, signature}` with an arbitrary signature. Without on-chain verification, fake rows enter the ledger and get reported to Panta — a direct wash-trading/attribution violation. | Verify on-chain: signature exists, succeeded, invoked the expected program, signer == account. Never trust the body. Unique index on signature. |
| **Untrusted `account`** | POST body `account` used as fee payer / identity. | `walletAddressSchema.safeParse` at the perimeter; treat as *a* payer only, never as authenticated identity. |
| **Amount/side injection** | Client contests the quote by sending arbitrary `amountUsdc`/`side` in the body instead of the server-baked href params. | Bake validated params into the action href; re-validate; server constructs both operands. |
| **Quote/blockhash TOCTOU** | Quote valid ~90s, blockhash window ~60s; a slow client signs a stale tx. | Re-quote/re-build server-side; refuse to return a tx past `expiresAt`; surface `QUOTE_EXPIRED`/`QUOTE_STALE`. |
| **DoS on the shared key** | Public GET/POST hammered → exhausts Panta's shared budget. | Enforce the `APP_REGISTRY.blink` budget + cache metadata; degrade to `budget-exhausted`, not silent success. |
| **IDOR / enumeration** | Probing ids or other wallets' signatures. | `MARKET_ID_PATTERN` before network (exists); ownership scoping at query level. |
| **Open proxy** | Blink routes calling arbitrary Panta paths. | Allow-listed operations only (`APP_REGISTRY.blink.allowedOperations`). |
| **CORS `*` + credentials** | Action endpoints must be public cross-origin but cookie-free. | `Access-Control-Allow-Origin: *` and **no credentials** — wallet-signed, not session-signed. |

---

## 6. Scope fork — still open

- **Read-only Blink first** — GET metadata + `actions.json` + CORS, buttons
  link to `/markets/[id]`. No wallet, no tx, no buy pipeline. Buildable now
  with what exists; days of work; a real functional Blink you can submit.
- **Full transaction Blink** — GET + POST (quote→build→assembled tx) +
  callback, backed by ledger/RPC/reconciler. The real product; blocked on the
  buy pipeline + tx compiler + on-chain verification being built first.
  Sequence: *buy pipeline (P6) → ledger/RPC → then the Blink on top.*

**Not yet decided:** whether to enforce the blink rate budget in the first
slice; the exact `Powered by Panta` copy in Blink metadata; when to fix the
devnet default in `types/env.ts`; Dialect registry submission timing.