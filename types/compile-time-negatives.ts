/**
 * Compile-time negative assertions.
 *
 * This file is type-checked by tsc under BOTH tsconfig.types.json and the app's
 * root tsconfig.json, and is never executed (it does not match the `*.test.ts`
 * glob, so vitest ignores it). Each `@ts-expect-error` fails the build if the
 * error it guards ever stops happening — which is what makes these assertions
 * real rather than decorative.
 */
import type { UsdcDecimal, UsdcBaseUnits, Price } from './money';
import type { MarketId, OrderId } from './ids';
import type { PrimaryMarket, SecondaryMarket } from './market';
import type { RawDraft, ValidatedDraft } from './draft';
import type { BuyQuote } from './buy';
import type { DisplayPrice, PantaBadge } from './compliance';
import type { OperationName } from './app-registry';

declare const someUsdc: UsdcDecimal;
declare const someBaseUnits: UsdcBaseUnits;
declare const someMarketId: MarketId;
declare const aSecondary: SecondaryMarket;
declare const aQuote: BuyQuote;
declare const aRawDraft: RawDraft;
declare const aPrice: Price;

declare function consumeValidated(_draft: ValidatedDraft): void;
declare function startBuy(_market: PrimaryMarket, _quote: BuyQuote): void;

// Money units cannot be mixed.
// @ts-expect-error base units are not USDC decimal strings
const mixMoney: UsdcDecimal = someBaseUnits;

// IDs cannot be mixed, even though both are strings at runtime.
// @ts-expect-error a MarketId is not an OrderId
const mixId: OrderId = someMarketId;

// A buy can only start from a primary market.
// @ts-expect-error a secondary market is not a primary market
startBuy(aSecondary, aQuote);

// A draft reaches the create flow only through the validators.
// @ts-expect-error a raw draft is not a validated draft
consumeValidated(aRawDraft);

// A display price requires an as-of timestamp.
// @ts-expect-error a display price requires an as-of timestamp
const badPrice: DisplayPrice = { amount: aPrice, provenance: 'live' };

// The badge text is enforced by a literal type.
// @ts-expect-error the badge must be exactly "Powered by Panta"
const badBadge: PantaBadge = 'Powered by Something Else';

// Surfaces may only run allowlisted operations.
// @ts-expect-error this operation is not in the allowlist
const badOperation: OperationName = 'admin:do-everything';

void someUsdc;
void mixMoney;
void mixId;
void badPrice;
void badBadge;
void badOperation;

export {};
