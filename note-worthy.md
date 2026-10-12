# note-worthy — Blink integration notes

> Working notes on integrating Solana Blinks (Solana Actions) into Callit.
> Captured 2026-10-11 from the readiness review + design conversation.
> Updated 2026-10-12: **slice 1 shipped** — a real transaction Blink minus
> the callback (GET metadata + POST quote→build→unsigned tx). The scope fork
> at the bottom is resolved; what remains is slice 2 (callback/RPC/reconciler).

---

## 1. Readiness verdict (the short version)

**Contracts: unusually ready. Slice 1 runtime: shipped. Slice 2 runtime: absent.**

The foundation was designed with Blinks in mind — `types/blink.ts` exists,
`APP_REGISTRY` already registers a `blink` app with scoped operations and a rate
budget, attribution already supports the `blink` surface, and the market-read
path + wallet validation + tx brands are all built. Slice 1 (2026-10-12) added
the pieces a transaction Blink needs up to the wallet: `actions.json` + CORS,
GET metadata with linked YES/NO actions, and a POST that quotes/builds/compiles
an **unsigned** version-0 transaction with the request account as the sole
fee payer/signer — returned, never signed. What is still missing is everything
*after* the wallet signs: the `links.next` callback, on-chain verification (no
RPC client), the `/trades/` report path, and the reconciler. Production Blinks
are therefore **submittable but not yet sellable**: a wallet can sign the tx,
but we structurally cannot yet close the loop and report the trade.

### What already exists

| Layer a Blink needs | State | Evidence |
|---|---|---|
| Blink wire contract (GET/POST/callback/error) | Exists (~70%), unused | `types/blink.ts` |
| App/surface registration + attribution | Exists | `types/app-registry.ts` (`blink` entry, budget reads:20/quotes:5/builds:5), `types/attribution.ts` (surface `'blink'`) |
| Market read for GET metadata | Exists | `lib/panta/read-adapters.ts`, `lib/panta/catalog.ts` |
| Wallet-address validation (untrusted `account`) | Exists | `types/wallet.ts`, `types/ids.ts` |
| Opaque-tx brand + signer check | Exists | `types/tx.ts` |
| Identity/session (Privy, signed cookie) | Exists | `lib/auth/*` — NOT used by Blinks (they're wallet-signed, not session-signed) |
| Actions contract and CORS | **Shipped slice 1** | `app/actions.json/`, `app/blink/[marketId]/`, `lib/blink/action-headers.ts` — `Access-Control-Allow-Origin: *`, no credentials, cookie-less by design |
| Tx assembly (unsigned, sole signer) | **Shipped slice 1** | `lib/solana/assemble.ts` (fail-closed gates + byte-for-byte re-decode), `lib/solana/sign.ts` |
| Budget enforcement | **Shipped slice 1** | `lib/ledger/rate-limit.ts` (Postgres atomic upsert), `APP_REGISTRY.blink.rateBudget` |
| Pending-order record | **Shipped slice 1** | `lib/ledger/pending-orders.ts` (partial-unique index on signature) |
| Catalog-gated market resolution | **Shipped slice 1** | `lib/blink/market.ts` (`loadMarketListingCached`, one cache key) |

### The five blockers, as they stand (slice 1 shipped)

1. **Buy pipeline — [x] resolved.** `lib/panta/buy-adapters.ts` + the
   `/api/panta/buy/{quote,build}` routes exist; the Blink POST calls
   quote→build server-side per request (client never supplies amounts).
   `buy/quote` perimeter-validates `side` (`sideWireSchema`) and `marketId`
   (`marketIdSchema`) before any Panta call.
2. **Transaction assembly — [x] resolved.** `lib/solana/assemble.ts` compiles
   Panta's `instructions[] + recentBlockhash + lastValidBlockHeight` into a
   base64 **unsigned** version-0 tx with the request `account` as fee payer.
   Gates: valid fee payer / blockhash / height, non-empty instructions, exactly
   one required signer == the request account (multi-sig laundering), per-row
   address + base64 validation, then a re-decode of the exact returned bytes
   through the same single-signer gate (TOCTOU). `@solana/kit` 8.4.0 in use.
3. **`actions.json` / routes / CORS — [x] resolved.** Route handlers carry
   OPTIONS preflight, `Access-Control-Allow-Origin: *` (no credentials),
   `Access-Control-Allow-Methods/Headers`, `Access-Control-Expose-Headers`,
   and `X-Action-Version` / `X-Blockchain-Ids: solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`
   (mainnet genesis). The Blink surface never imports the session auth helpers.
4. **Ledger — [~] partial.** `lib/ledger/` ships: PG pool
   (`DATABASE_URL ?? POSTGRES_URL`), atomic `consumeRateLimit` upsert, and
   `pending_orders` writes (the build step records order id / quote id /
   market / account / amount / fee, keyed for the future callback). Missing
   (slice 2): `/trades/` report exposure (adapter exists in
   `lib/panta/trades-adapters.ts`), ledger stats, reconciler.
5. **RPC / confirmation — [ ] slice 2.** No RPC client exists, so slice 1
   cannot verify blockhash liveness (documented residual). ⚠️ `types/env.ts`
   still defaults `SOLANA_RPC_URL` to devnet while the product is
   **mainnet-only** — must be mainnet-enforced before the RPC client lands.

Supporting gaps, slice 1: **resolved** — DB-backed rate budget enforcement on
the public Blink surface (atomic Postgres upsert against `APP_REGISTRY.blink`
reads:20/quotes:5/builds:5, degrade to `budget-exhausted`, never silent
success); metadata cache (catalog-gated resolver, one cache key, limits
upstream amplification to catalog-listed markets); `NEXT_PUBLIC_APP_URL`
consumed via `lib/seo/site.ts` for absolute URLs; exact `Powered by Panta`
badge enforced in Blink title/description (`PANTA_BADGE` +
`sanitizeCopyWithBadge`, badge survives truncation). **Still open (slice 2):**
RPC, callback, reconciler, Dialect registry submission.

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

| Vector | Concrete scenario | Closing construct | Slice-1 status |
|---|---|---|---|
| **Callback forgery / fake volume** | Anyone POSTs `{account, signature}` with an arbitrary signature. Without on-chain verification, fake rows enter the ledger and get reported to Panta — a direct wash-trading/attribution violation. | Verify on-chain: signature exists, succeeded, invoked the expected program, signer == account. Never trust the body. Unique index on signature. | **slice 2** — no callback route exists yet; unique index on `signature` designed (`pending_orders`) |
| **Untrusted `account`** | POST body `account` used as fee payer / identity. | `walletAddressSchema.safeParse` at the perimeter; treat as *a* payer only, never as authenticated identity. | **closed** — perimeter parse + assembler Gate 1/Gate 3 |
| **Amount/side injection** | Client contests the quote by sending arbitrary `amountUsdc`/`side` in the body instead of the server-baked href params. | Bake validated params into the action href; re-validate; server constructs both operands. | **closed** — fixed presets (5/25) in href; `sideWireSchema`/`marketIdSchema` at perimeter; quote+build run server-side, amounts never client-supplied |
| **Quote/blockhash TOCTOU** | Quote valid ~90s, blockhash window ~60s; a slow client signs a stale tx. | Re-quote/re-build server-side; refuse to return a tx past `expiresAt`; surface `QUOTE_EXPIRED`/`QUOTE_STALE`. | **mostly closed** — re-quote/re-build per request; residual: blockhash liveness unverifiable without RPC (slice 2) |
| **DoS on the shared key** | Public GET/POST hammered → exhausts Panta's shared budget. | Enforce the `APP_REGISTRY.blink` budget + cache metadata; degrade to `budget-exhausted`, not silent success. | **closed** — DB atomic rate limit + catalog cache |
| **IDOR / enumeration** | Probing ids or other wallets' signatures. | `MARKET_ID_PATTERN` before network; ownership scoping at query level. | **closed** — ids resolve only when catalog-listed (`loadMarketListingCached`); `MARKET_ID_PATTERN` pre-network |
| **Open proxy** | Blink routes calling arbitrary Panta paths. | Allow-listed operations only (`APP_REGISTRY.blink.allowedOperations`). | **closed** — blink POST calls quote/build server-side, never arbitrary Panta paths |
| **CORS `*` + credentials** | Action endpoints must be public cross-origin but cookie-free. | `Access-Control-Allow-Origin: *` and **no credentials** — wallet-signed, not session-signed. | **closed** — headers shipped; Blink routes never import the session auth helpers |

---

## 6. Scope fork — RESOLVED (slice 1 shipped 2026-10-12)

The fork resolved to **full transaction Blink, sliced**:

- **Slice 1 (shipped):** `actions.json` + CORS + GET metadata (YES/NO linked
  actions, fixed USDC presets 5/25) + POST (quote→build→assembled unsigned tx,
  request account = sole signer). No callback, no signing — the go/no-go sign
  gate is untouched. Catalog-gated resolver, DB rate budget, `pending_orders`
  record, fail-closed assembler gates.
- **Slice 2 (next):** `links.next` callback + on-chain verification (RPC
  client first) + `/trades/` report via `lib/panta/trades-adapters.ts` +
  reconciler. Sequence: *RPC client → callback route → report path → reconciler.*

Residuals deliberately deferred: blockhash-liveness verification (needs RPC);
the devnet `SOLANA_RPC_URL` default in `types/env.ts` (must be mainnet-enforced
before RPC lands); Dialect registry submission timing.