/**
 * format — pure display formatters.
 *
 * No money math here. Prices and volumes are decimal strings from the domain;
 * these helpers only reshape them for display (string manipulation, no floats).
 */
import type { AsOf, Price, UnixSeconds, UsdcDecimal } from "@/types";

/**
 * "0.62" -> "62"; "0.625" -> "62.5"; "1" -> "100"; "0.05" -> "5".
 * Purely string-based — shifts the decimal point two places right.
 */
export function percentFromPrice(price: Price): string {
  const [whole = "0", frac = ""] = price.split(".");
  const padded = `${frac}00`.slice(0, 2);
  const shiftedWhole = `${whole}${padded}`.replace(/^0+(?=\d)/, "");
  const rest = frac.slice(2).replace(/0+$/, "");
  return rest ? `${shiftedWhole}.${rest}` : shiftedWhole;
}

/** ISO "as of" -> "14:32 UTC" for the price provenance line. */
export function formatAsOf(asOf: AsOf): string {
  const date = new Date(asOf);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}

/** Unix seconds -> date-only string ("Oct 10, 2026") for facts rows. */
export function formatUnixDate(seconds: UnixSeconds): string {
  return new Date(seconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * "84210.5" -> "$84,210.50". Groups the integer part, pads/truncates the
 * fraction to two digits — all on the string, no float conversion, consistent
 * with the no-money-math rule at the top of this file.
 */
export function formatUsdc(usdc: UsdcDecimal): string {
  const [whole = "0", frac = ""] = usdc.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = `${frac}00`.slice(0, 2);
  return `$${grouped}.${cents}`;
}