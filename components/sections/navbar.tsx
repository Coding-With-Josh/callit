"use client";
import { PlusCircle, Search } from "lucide-react";
import Link from "next/link";
import React from "react";
import { handleSectionLink } from "@/lib/lenis";

// Brand icons: lucide removed its brand icons in v1.53, so these are the
// official logo paths. fill="currentColor" makes them inherit the link color.
const XIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const GithubIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 16 16"
    className={className}
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

export const Navbar = () => {
  return (
    <div className="backdrop-blur-lg w-full py-4 flex top-0 fixed items-center justify-between px-4 md:px-12">
      {/* Social links — icon + label on desktop; icon-only below md so the row
          fits a phone screen. aria-label keeps the icon-only links accessible. */}
      <div className="flex items-center justify-start gap-4 w-[30vw]">
        <Link
          href="https://x.com/call_it"
          aria-label="X (formerly Twitter)"
          className="flex items-center gap-1.5 text-[#2D1C00] font-tusker-6700 font-semibold hover:scale-101 active:scale-99 transition-all tracking-tight"
        >
          <XIcon className="size-4" />
          <span className="hidden md:inline">X (formerly Twitter)</span>
        </Link>
        <Link
          href="https://github.com/Coding-With-Josh/callit"
          aria-label="GitHub"
          className="flex items-center gap-1.5 text-[#2D1C00] font-tusker-6700 font-semibold hover:scale-101 active:scale-99 transition-all tracking-tight"
        >
          <GithubIcon className="size-4" />
          <span className="hidden md:inline">Github</span>
        </Link>
      </div>
      {/* flex-1 centers the brand in the free space on mobile; md:flex-none
          restores the original auto-width box centered by justify-between. */}
      <Link href="/" className="flex-1 md:flex-none">
        <h1 className="flex-1 text-center md:flex-none text-xl w-[30vw] font-tusker-9800 text-[#2D1C00]">
          callit
        </h1>
      </Link>
      {/* Mobile: compact icon-only buttons justified right. Desktop: original
          centered 30vw column with full labels and gap-4. */}
      <div className="flex items-center justify-end gap-2 md:gap-4 w-[30vw] md:justify-center">
       <Link href="/create">
        <button
          aria-label="Create a market"
          className="py-3 px-3 md:px-6 font-tusker-6700 font-medium bg-[#2D1C00] flex items-center justify-center rounded-full hover:scale-102 active:scale-98 transition-all cursor-pointer"
        >
          <PlusCircle className="mr-0 md:mr-2 size-5" strokeWidth={2.5} />
          {/* Label appears at md+ so buttons are tap-friendly icons on phones */}
          <span className="hidden md:inline">Create a market</span>
        </button></Link>
        {/* Cross-page safe: intercepts only when #browse exists on this page;
            otherwise the browser follows href="/#browse" (scroll={false} on
            the Link so Next doesn't top-align first; SmoothScroll's hash
            effect then centers the section). */}
        <Link
          href="/#browse"
          scroll={false}
          aria-label="Browse markets"
          onClick={(e) => handleSectionLink(e, "#browse")}
          className="py-3 px-3 md:px-6 text-[#2D1C00] font-tusker-6700 font-medium bg-[#2D1C00]/20 flex items-center justify-center rounded-full hover:scale-102 active:scale-98 transition-all cursor-pointer"
        >
          <Search className="mr-0 md:mr-2 size-4" strokeWidth={2.5} />
          <span className="hidden md:inline">Browse markets</span>
        </Link>
      </div>
    </div>
  );
};
