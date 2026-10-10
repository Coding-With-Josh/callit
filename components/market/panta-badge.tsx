import { PANTA_BADGE } from "@/types";

/**
 * The one badge component. Renders the exact required string from
 * types/compliance::PANTA_BADGE so the copy can't drift (README: the badge
 * must appear near every Panta-powered surface; rendering is on us, the
 * constant keeps it exact).
 *
 * tone: "light" sits on cream/ink surfaces (default); "dark" sits on the ink
 * board/band. The rendered string is identical either way.
 */
export const PantaBadge = ({
  className = "",
  tone = "light",
}: {
  className?: string;
  tone?: "light" | "dark";
}) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold tracking-tight ${
      tone === "dark"
        ? "bg-[#FFF2DD]/5 text-[#FFF2DD] ring-1 ring-[#FFF2DD]/0"
        : "bg-[#2D1C00]/10 text-[#2D1C00]"
    } ${className}`}
  >
    {PANTA_BADGE}
  </span>
);