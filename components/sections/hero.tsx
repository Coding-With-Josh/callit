"use client";
import React from "react";
import { ArrowUpRightFromSquare, Plus, PlusCircle, Search } from "lucide-react";
import { handleSectionLink } from "@/lib/lenis";
import Link from "next/link";

export const Hero = () => {
  return (
    <div className="flex flex-col items-center justify-center w-full h-screen">
      {/* Scales down on phones so the headline never wraps mid-word;
            md:text-6xl restores the original desktop size, sm:/md: for tablets. */}
      <h1 className="text-4xl sm:text-5xl md:text-6xl font-tusker-9800 text-[#2D1C00] text-center">
        Call it. Back it.
      </h1>
      <h1 className="text-sm md:text-lg leading-tight font-sans text-[#2D1C00] font-medium tracking-tight mt-4 max-w-xl text-center px-6 sm:px-0">
        Turn any claim into a market people can back with YES or NO. Share the
        link on X or Telegram and anyone can take a side in a tap.
      </h1>

      {/* Mobile: stacked full-width buttons with edge padding. Desktop:
          original centered row. mt-6 moved here keeps the 24px gap below the
          subtitle identical on desktop without double spacing when stacked. */}
      <div className="flex flex-col items-center justify-center gap-3 w-full px-6 mt-6 sm:flex-row sm:gap-4 sm:w-auto sm:px-0">
        <Link href="/create">
          <button className="w-full sm:w-auto py-3 px-6 font-tusker-6700 font-medium text-[#FFF2DD] bg-[#2D1C00] flex items-center justify-center rounded-full hover:scale-102 active:scale-98 transition-all cursor-pointer">
            <PlusCircle className="mr-2 size-5" strokeWidth={2.5} />
            Create a market
          </button>
        </Link>
        {/* Anchor + smooth scroll: Lenis if running, native jump otherwise.
            href="/#browse" also works cross-page and with JS disabled;
            scroll={false} lets SmoothScroll center the section instead of
            Next top-aligning it. */}
        <Link
          href="/#browse"
          scroll={false}
          onClick={(e) => handleSectionLink(e, "#browse")}
          className="w-full sm:w-auto py-3 px-6 text-[#2D1C00] font-tusker-6700 font-medium bg-[#2D1C00]/20 flex items-center justify-center rounded-full hover:scale-102 active:scale-98 transition-all cursor-pointer"
        >
          <Search className="mr-2 size-4" strokeWidth={2.5} />
          Browse markets
        </Link>
      </div>
    </div>
  );
};
