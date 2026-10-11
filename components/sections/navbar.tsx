"use client";
import { PlusCircle } from "lucide-react";
import Link from "next/link";
import React from "react";
import { WalletPill } from "@/components/auth/wallet-pill";

export const Navbar = () => {
  return (
    <div className="fixed top-0 z-40 flex w-full items-center justify-between px-4 py-4 backdrop-blur-lg md:px-12">
      {/* Left: wordmark only (social moved to footer) */}
      <div className="flex w-1/3 items-center justify-start">
        <Link href="/" className="block">
          {/* Wordmark, not a heading: it repeats on every page, so an <h1> here
              would put two h1s on the home page and a stray one on every other
              (Phase 1: one h1 per document). */}
          <span className="text-xl font-tusker-9800 text-[#2D1C00]">callit</span>
        </Link>
      </div>

      {/* Center: keep minimal on mobile; desktop also minimal */}
      <div className="flex w-1/3 items-center justify-center"></div>

      {/* Right: Create + Wallet pill */}
      <div className="flex w-1/3 items-center justify-end gap-2 md:gap-3">
        <Link href="/create">
          <button
            aria-label="Create a market"
            className="flex items-center justify-center rounded-full bg-[#2D1C00] px-3 py-2.5 font-sans text-xs font-medium tracking-tight text-[#FFF2DD] transition hover:scale-102 active:scale-98 cursor-pointer md:px-5 md:text-sm"
          >
            <PlusCircle className="mr-0 md:mr-2 size-4 md:size-5" strokeWidth={2.5} />
            <span className="hidden md:inline">Create a market</span>
          </button>
        </Link>
        <WalletPill />
      </div>
    </div>
  );
};
