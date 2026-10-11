/**
 * /dev is a client-only smoke-test page and exports no metadata of its own, so
 * it would otherwise inherit the root (indexable) metadata. This server layout
 * is the only place a client page's route segment can carry a `robots` directive.
 *
 * Phase 3 (index-state injection): /dev must never appear in an index. Defence
 * in depth behind the robots.txt `Disallow: /dev` rule.
 */
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dev smoke test",
  robots: { index: false, follow: false, nocache: true },
};

export default function DevLayout({ children }: { children: React.ReactNode }) {
  return children;
}
