"use client";
import React from "react";
import { PlusCircle, Search } from "lucide-react";
import { handleSectionLink } from "@/lib/lenis";
import Link from "next/link";

export const Hero = () => {
  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center py-24">
      {/* min-h-dvh (not h-screen): 100vh overshoots the visible area behind
          mobile browser chrome, which pushed the buttons under the URL bar on
          short viewports. min-h-* lets the hero grow and the page scroll
          instead of clipping; py-24 is the fixed navbar's height, so content is
          never hidden beneath it. */}
      {/* Scales down on phones so the headline never wraps mid-word;
            md:text-6xl restores the original desktop size, sm:/md: for tablets. */}
      <h1 className="text-4xl sm:text-5xl md:text-6xl font-tusker-9800 text-[#2D1C00] text-center">
        Call it. <br className="md:hidden block" /> Back it.
      </h1>
      {/* Supporting line is a <p>, not a second <h1>: the document keeps exactly
          one h1 (the headline above) for screen readers and crawlers. */}
      <p className="text-sm md:text-lg leading-tight font-sans text-[#2D1C00] font-medium tracking-tight mt-4 max-w-xl text-center px-6 sm:px-0">
        Turn any claim into a market people can back with YES or NO. Share the
        link on X or Telegram and anyone can take a side in a tap.
      </p>

      {/* Buttons. One rule, one breakpoint: stacked full-width while the row is a
          column, auto-width once it becomes a row — both switch at md:, so the
          widths can't desync from the direction (they did when the row was md:
          but a width was sm:). The stacked width is capped at max-w-sm so the
          640-767px band doesn't get full-bleed buttons on a ~700px viewport;
          the cap is inert on real phones, where the viewport is already narrower.
          `mt-6` lives here so the 24px gap below the subtitle stays identical on
          desktop without double spacing when stacked. */}
      <div className="mt-6 flex w-full flex-col items-center justify-center gap-4 px-6 md:max-w-xl md:flex-row md:gap-3">
        <div className="relative">
          <Link
            href="/create"
            onClick={(e) => e.preventDefault()}
            tabIndex={-1}
            aria-disabled="true"
            className="flex w-full max-w-sm items-center justify-center whitespace-nowrap rounded-full bg-[#2D1C00] px-6 py-3 font-sans font-medium tracking-tight text-[#FFF2DD] transition-all hover:scale-102 active:scale-98 cursor-pointer md:w-auto md:max-w-none pointer-events-none opacity-60"
          >
            <PlusCircle className="mr-2 size-5" strokeWidth={2.5} />
            Create a market
          </Link>
          {/* <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="bg-[#2D1C00]/10 text-[#FFF2DD] px-4 py-1 rounded-full text-sm font-sans font-medium tracking-tight">Coming soon</span>
          </div> */}
        </div>
        {/* Anchor + smooth scroll: Lenis if running, native jump otherwise.
            href="/#browse" also works cross-page and with JS disabled;
            scroll={false} lets SmoothScroll center the section instead of
            Next top-aligning it. */}
        <Link
          href="/#browse"
          scroll={false}
          onClick={(e) => handleSectionLink(e, "#browse")}
          className="flex w-full max-w-sm items-center justify-center whitespace-nowrap rounded-full bg-[#2D1C00]/20 px-6 py-3 font-sans font-medium tracking-tight text-[#2D1C00] transition-all hover:scale-102 active:scale-98 cursor-pointer md:w-auto md:max-w-none"
        >
          <Search className="mr-2 size-4" strokeWidth={2.5} />
          Browse markets
        </Link>
      </div>
    </div>
  );
};
