/* eslint-disable react-hooks/preserve-manual-memoization */
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link2, Loader2, Pencil, Plus, X } from "lucide-react";
import { usePrivyGate } from "@/components/auth/use-privy-gate";
import {
  checkResolvabilityStep,
  checkSource,
  draftFromClaim,
  editDraft,
  effectiveStartSeconds,
  fixtureCreateAdapters,
  openQuoteStep,
  requireVerifiedSource,
  uploadCoverStep,
  validateDraftStep,
  type CreateAdapters,
  type CreateMarketError,
  type SourceCheck,
} from "@/lib/create-market";
import {
  asOf,
  feeDisclosure,
  isoFromUnix,
  MIN_STANDARD_LEAD_SECONDS,
  unixSeconds,
  type AsOf,
  type CreateLifecycle,
  type CreateQuote,
  type DataProvenance,
  type RawDraft,
} from "@/types";
import { formatAsOf, formatUnixDate, formatUsdc } from "@/lib/format";
import { loadCoverFontCss, templatedCoverDataUri } from "@/lib/create-image";
import { PantaBadge } from "@/components/market/panta-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The create wizard — one client island, the whole staged worksheet.
 *
 * Phase 1 (complete mediation): the island never constructs a lifecycle object
 * itself. Every stage it renders comes back from lib/create-market, so the only
 * way to reach `validated` / `resolvable` / `quoted` is through the service's
 * validators and transition guards. A revision goes through `editDraft` (a
 * fresh `drafted`), never a hand-built draft.
 *
 * Preview scope (decisions): fixture adapters only; the walk stops at a
 * DISABLED sign step. This island never calls buildStep / signStep, so no
 * transaction is built, no signature is produced, and no market id exists —
 * there is no fake "registered" screen.
 */

const adapters: CreateAdapters = fixtureCreateAdapters;

const STEPS = ["Claim", "Draft", "Resolve", "Quote", "Sign"] as const;

type StageState = "active" | "done" | "locked";
type WizardStatus = "intake" | CreateLifecycle["status"];

const inputClass =
  "w-full rounded-xl bg-[#2D1C00]/5 px-4 py-3 text-sm tracking-tight text-[#2D1C00] font-medium placeholder:text-[#2D1C00]/35 outline-none ring-1 ring-[#2D1C00]/10 transition focus:ring-2 focus:ring-[#2D1C00]/30";
const labelClass =
  "block font-tusker-6700 text-[11px] font-medium uppercase tracking-[0.22em] text-[#2D1C00]/50";

const dateInputValue = (seconds: number): string =>
  new Date(seconds * 1000).toISOString().slice(0, 10);

/** Plain number -> branded UnixSeconds -> display string ("Apr 14, 2026"). */
const displayDate = (seconds: number): string =>
  formatUnixDate(unixSeconds(seconds));

const unixFromDateInput = (value: string): number | null => {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
};

/** Calendar-day floor (UTC). Plain math — never throws on draft values. */
const DAY_SECONDS = 86_400;
const dayStartOf = (seconds: number): number =>
  Math.floor(seconds / DAY_SECONDS) * DAY_SECONDS;

/** Key per-source checks by URL for the wizard's chips. */
const checksRecord = (
  checks: readonly SourceCheck[],
): Record<string, SourceCheck> =>
  Object.fromEntries(checks.map((check) => [check.url, check]));

/**
 * The sign step's gate (Phase 1: complete mediation).
 *
 * Connecting a wallet here is an *affordance* only — it grants no server
 * privilege, and this island is never the authority. The server route that will
 * build/sign re-checks auth independently and fails closed. It constructs
 * nothing: live signing stays disabled in preview, so no transaction is built
 * or signed and no market id is fabricated.
 */
const SignStepButton = () => {
  const { ready, authenticated, unavailable, login } = usePrivyGate();

  if (!authenticated) {
    const blocked = unavailable;
    return (
      <button
        type="button"
        disabled={!ready || blocked}
        aria-busy={!ready && !blocked}
        title={
          blocked
            ? "Wallet login is unavailable — this origin must be allowlisted in the Privy dashboard"
            : undefined
        }
        onClick={() => {
          if (ready) login();
        }}
        className="w-full rounded-full bg-[#2D1C00] py-3 text-sm font-semibold tracking-tight text-[#FFF2DD] transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
      >
        {blocked ? "Login unavailable" : "Connect to sign"}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title="Live signing lands with the trading backend"
      className="w-full cursor-not-allowed rounded-full bg-[#2D1C00]/15 py-3 text-sm font-semibold tracking-tight text-[#2D1C00]/50"
    >
      Sign with wallet
    </button>
  );
};

/**
 * The generated cover, as an image. Fetches the Tusker face once (cached in
 * `loadCoverFontCss`) and embeds it in the SVG so the headline renders in the
 * house face inside an `<img>`.
 *
 * No system-font flash: until the font promise settles we render a skeleton
 * instead of the fallback-face card, so the correctly-fonted card is the first
 * thing the user sees. The card then fades in — never a sharp swap. If the
 * fetch fails the promise still resolves (to `""`) and the card fades in on
 * the `system-ui` fallback rather than leaving a permanent skeleton.
 */
const CoverPreview = ({ question }: { question: string }) => {
  // null = still waiting for the embedded font; "" = settled (possibly failed).
  const [fontCss, setFontCss] = useState<string | null>(null);
  // Flipped after one painted frame at opacity-0, so the transition runs.
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadCoverFontCss().then((css) => {
      if (!alive) return;
      setFontCss(css);
      requestAnimationFrame(() => {
        if (alive) setRevealed(true);
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  // Memoised: the data URI embeds the whole font (~48KB base64), so it must not
  // be rebuilt on every render.
  const src = useMemo(
    () => templatedCoverDataUri(question, fontCss ?? ""),
    [question, fontCss],
  );

  if (fontCss === null) {
    // Cream block echoing the card's ground; the figure's rounded ring clips
    // it to the same shape as the finished card, so only opacity changes.
    return (
      <div
        aria-hidden="true"
        className="aspect-[1200/630] w-full animate-pulse bg-[#FFF2DD]"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG data URI, not a remote/optimisable asset; next/image adds nothing here.
    <img
      src={src}
      alt="Preview of the generated market cover"
      className={`aspect-[1200/630] w-full object-cover opacity-0 motion-safe:transition-opacity motion-safe:duration-500 ease-out ${
        revealed ? "opacity-100" : ""
      }`}
    />
  );
};

export const CreateWizard = () => {
  const [claim, setClaim] = useState("");
  const [raw, setRaw] = useState<RawDraft | null>(null);
  const [lifecycle, setLifecycle] = useState<CreateLifecycle | null>(null);
  const [error, setError] = useState<CreateMarketError | null>(null);
  const [busy, setBusy] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [categories, setCategories] = useState<readonly string[]>([]);
  const [showDates, setShowDates] = useState(false);
  // Verified-source chips: keyed by the trimmed URL, stamped by the service.
  const [sourceChecks, setSourceChecks] = useState<Record<string, SourceCheck>>({});
  const [verifyingSources, setVerifyingSources] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [startDateError, setStartDateError] = useState<string | null>(null);

  const status: WizardStatus = lifecycle ? lifecycle.status : "intake";

  // Calendar-day view of the start date: today vs a later pick (the user is
  // told the market opens on the day they set), and the lead this draft needs.
  const startDay = raw ? dayStartOf(raw.startTime) : dayStartOf(adapters.now());
  const opensLater = startDay > dayStartOf(adapters.now());
  const startLeadSeconds =
    raw?.marketType === "breaking" && raw.eventInProgress === true
      ? 0
      : MIN_STANDARD_LEAD_SECONDS;

  useEffect(() => {
    let active = true;
    void adapters
      .fetchCategories()
      .then((list) => {
        if (active) setCategories(list);
      })
      .catch(() => {
        if (active) setCategories([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const updateRaw = (edits: Partial<RawDraft>) =>
    setRaw((prev) => (prev ? { ...prev, ...edits } : prev));

  /** Persist a sources edit and invalidate checks for URLs that no longer
   *  exist in the list. Fail-closed: an edited URL must verify again — the
   *  old verdict never carries over. */
  const updateSources = (next: readonly string[]) => {
    updateRaw({ sourcesOfTruth: [...next] });
    const present = new Set(
      next.map((source) => source.trim()).filter((s) => s.length > 0),
    );
    setSourceChecks((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([url]) => present.has(url)),
      ),
    );
  };

  /** Verify one source through the service (never the adapter directly). */
  const onVerifySource = async (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setVerifyingSources((prev) => new Set(prev).add(trimmed));
    try {
      const check = await checkSource(trimmed, adapters);
      setSourceChecks((prev) => ({ ...prev, [trimmed]: check }));
    } finally {
      setVerifyingSources((prev) => {
        const next = new Set(prev);
        next.delete(trimmed);
        return next;
      });
    }
  };

  const stepIndex = useMemo(() => {
    switch (status) {
      case "drafted":
      case "validated":
        return 1;
      case "resolvable":
        return 2;
      case "quoted":
      case "create_expired":
        return 3;
      case "built":
      case "signed":
      case "registered":
        return 4;
      default:
        return 0;
    }
  }, [status]);

  const onGenerate = () =>
    run(async () => {
      setError(null);
      const result = await draftFromClaim(claim, adapters);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLifecycle(result.value);
      setRaw(result.value.status === "drafted" ? result.value.raw : null);
      setCoverUrl(null);
      setShowDates(false);
      setSourceChecks({});
      setVerifyingSources(new Set());
      setStartDateError(null);
    });

  const onContinueDraft = () =>
    run(async () => {
      if (!raw) return;
      setError(null);
      // Phase 1 (source-of-truth gate): no next stage without at least one
      // VERIFIED public source of truth. Re-verifies fresh on every continue.
      const gate = await requireVerifiedSource(raw.sourcesOfTruth, adapters);
      if (!gate.ok) {
        if (gate.error.kind === "unverified_source") {
          setSourceChecks(checksRecord(gate.error.checks));
        }
        setError(gate.error);
        return;
      }
      setSourceChecks(checksRecord(gate.value));
      // Revision is a fresh draft (Phase 1): edits apply through the service.
      const restarted = editDraft(raw, {});
      const validated = await validateDraftStep(restarted, adapters);
      setLifecycle(validated.ok ? validated.value : restarted);
      if (!validated.ok) {
        setError(validated.error);
        return;
      }
      const resolved = await checkResolvabilityStep(validated.value);
      if (!resolved.ok) {
        setError(resolved.error);
        return;
      }
      setLifecycle(resolved.value);
      // The invisible image step: template -> upload -> public URL, before the
      // quote. Fail-closed: without a URL the quote is never opened.
      const cover = await uploadCoverStep(raw, adapters);
      if (!cover.ok) {
        setError(cover.error);
        return;
      }
      setCoverUrl(cover.value);
    });

  const onOpenQuote = () =>
    run(async () => {
      if (!lifecycle || lifecycle.status !== "resolvable") return;
      setError(null);
      // Fresh verification at the spend boundary (Phase 3: no stale source
      // proof) — a source that went down since the draft stage stops here.
      const gate = await requireVerifiedSource(
        lifecycle.draft.sourcesOfTruth,
        adapters,
      );
      if (!gate.ok) {
        if (gate.error.kind === "unverified_source") {
          setSourceChecks(checksRecord(gate.error.checks));
        }
        setError(gate.error);
        return;
      }
      setSourceChecks(checksRecord(gate.value));
      let url = coverUrl;
      if (!url && raw) {
        const cover = await uploadCoverStep(raw, adapters);
        if (!cover.ok) {
          setError(cover.error);
          return;
        }
        url = cover.value;
        setCoverUrl(url);
      }
      const quoted = await openQuoteStep(lifecycle, adapters, url ?? "");
      if (!quoted.ok) {
        setError(quoted.error);
        return;
      }
      setLifecycle(quoted.value);
    });

  const onRevise = () => {
    if (!raw) return;
    setLifecycle(editDraft(raw, {}));
    setError(null);
    setCoverUrl(null);
    setSourceChecks({});
    setVerifyingSources(new Set());
    setStartDateError(null);
  };

  const onStartOver = () => {
    setClaim("");
    setRaw(null);
    setLifecycle(null);
    setError(null);
    setCoverUrl(null);
    setShowDates(false);
    setSourceChecks({});
    setVerifyingSources(new Set());
    setStartDateError(null);
  };

  const draftActive = status === "drafted" || status === "validated";
  const resolveReached =
    status === "resolvable" ||
    status === "quoted" ||
    status === "create_expired";
  const resolveActive = status === "resolvable";
  const quoteReached = status === "quoted" || status === "create_expired";

  const categoryOptions = useMemo(() => {
    const set = new Set(categories);
    if (raw?.category) set.add(raw.category);
    return [...set];
  }, [categories, raw?.category]);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pt-28 pb-24 md:px-8">
      <header>
        {/* <p className="font-sans text-md font-medium text-[#2D1C00]/50">
          Create a market
        </p> */}
        <h1 className="mt-3 font-tusker-9800 text-4xl leading-[1.02] tracking-tight text-[#2D1C00] md:text-6xl">
          create a market.
        </h1>
        <p className="mt-4 max-w-xl text-sm font-medium leading-relaxed tracking-tight text-[#2D1C00]/70 md:text-base">
          Paste the claim, shape how it resolves, see the fee from Panta&apos;s
          quote, then sign. Nothing is charged until you sign.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <PantaBadge />
        
        </div>
      </header>

      <ol className="mt-10 flex flex-wrap items-center gap-2">
        {STEPS.map((label, index) => {
          const state =
            index < stepIndex ? "done" : index === stepIndex ? "live" : "todo";
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={`font-tusker-6700 text-sm uppercase tracking-[0.18em] ${
                  state === "todo"
                    ? "text-[#2D1C00]/30"
                    : state === "live"
                      ? "text-[#2D1C00]"
                      : "text-[#2D1C00]/50"
                }`}
              >
                {label}
              </span>
              {index < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`h-0.5 rounded-full w-4 ${
                    index < stepIndex ? "bg-[#2D1C00]/40" : "bg-[#2D1C00]/15"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-10 flex flex-col gap-8">
        {/* 01 — Claim */}
        <Section
          index={1}
          title="Claim"
          state={lifecycle ? "done" : "active"}
          summary={lifecycle ? claim : undefined}
          onEdit={lifecycle ? onStartOver : undefined}
        >
          {/* <label htmlFor="claim" className={labelClass}>
            The claim
          </label> */}
          <textarea
            id="claim"
            value={claim}
            onChange={(event) => setClaim(event.target.value)}
            rows={2}
            spellCheck={false}
            placeholder="e.g. Will Bitcoin close above $150,000 in 2026?"
            className={`mt-2 ${inputClass}`}
          />
          <div className="mt-4">
            <Pill onClick={onGenerate} busy={busy}>
              Generate draft
            </Pill>
          </div>
          {!lifecycle && <ErrorPanel error={error} />}
        </Section>

        {/* 02 — Draft */}
        {lifecycle && raw && (
          <Section
            index={2}
            title="Draft"
            state={draftActive ? "active" : "done"}
            summary={
              // The draft review shows what the claim does NOT: the market's
              // spec (category, schedule, sources) and the resolution rule.
              // Repeating the question here only duplicated section 01 (which
              // already shows it), so it is deliberately omitted.
              !draftActive ? (
                <div className="flex flex-col gap-6">
                  <DraftSpec raw={raw} />
                  <DraftRule rule={raw.resolutionRule} />
                </div>
              ) : undefined
            }
            onEdit={!draftActive ? onRevise : undefined}
          >
            <div className="flex flex-col gap-5">
              {/* The invisible image step made visible: a templated cover from
                  the question. Always labeled preview. Rendered as an <img> of a
                  self-contained SVG data URI — the Tusker face is embedded
                  inside the SVG (see loadCoverFontCss) because an <img> is an
                  isolated document that cannot reach the page's webfonts. The
                  question is XML-escaped by templatedCoverDataUri. */}
              <figure className="overflow-hidden rounded-2xl ring-1 ring-[#2D1C00]/10">
                <CoverPreview question={raw.question} />
                <figcaption className="bg-[#2D1C00]/5 px-3 py-2 font-tusker-6700 text-[10px] uppercase tracking-[0.18em] text-[#2D1C00]/45">
                  Cover preview · generated from the question
                </figcaption>
              </figure>

              {/* Live preview of the market's shape. Same read source and same
                  component as the collapsed review (DraftSpec), so the preview
                  and the review can never disagree. */}
              <DraftSpec raw={raw} />

              {raw.injection.suspicious && (
                <p
                  role="alert"
                  className="rounded-xl bg-amber-50 px-4 py-3 text-xs font-medium leading-relaxed text-amber-900 ring-1 ring-amber-200"
                >
                  This claim looked like a prompt-injection attempt to the
                  parser. It was treated as data, not instructions — review it
                  before continuing.
                </p>
              )}

              {/* The read-only preview ends here; everything below edits it.
                  Without this rule the preview spec and the editable fields
                  read as one wall of duplicated text. */}
              <div className="flex items-center gap-3">
                <span className="font-tusker-6700 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#2D1C00]/40">
                  Adjust draft
                </span>
                <span aria-hidden="true" className="h-px flex-1 bg-[#2D1C00]/10" />
              </div>

              <div>
                <label htmlFor="draft-question" className={labelClass}>
                  Question
                </label>
                <textarea
                  id="draft-question"
                  value={raw.question}
                  maxLength={512}
                  rows={2}
                  onChange={(event) =>
                    updateRaw({ question: event.target.value })
                  }
                  className={`mt-2 ${inputClass}`}
                />
              </div>

              <div>
                <label htmlFor="draft-rule" className={labelClass}>
                  Resolution rule
                </label>
                <textarea
                  id="draft-rule"
                  value={raw.resolutionRule}
                  maxLength={2048}
                  rows={4}
                  onChange={(event) =>
                    updateRaw({ resolutionRule: event.target.value })
                  }
                  className={`mt-2 ${inputClass}`}
                />
              </div>

              <div>
                <span className={labelClass}>Sources of truth</span>
                <div className="mt-2 flex flex-col gap-3">
                  {raw.sourcesOfTruth.map((source, index) => {
                    const trimmed = source.trim();
                    const check = trimmed ? sourceChecks[trimmed] : undefined;
                    const checking =
                      trimmed !== "" && verifyingSources.has(trimmed);
                    return (
                      <div key={index} className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="url"
                            value={source}
                            placeholder="https://…"
                            spellCheck={false}
                            autoComplete="off"
                            onChange={(event) => {
                              const next = raw.sourcesOfTruth.map(
                                (current, i) =>
                                  i === index ? event.target.value : current,
                              );
                              updateSources(next);
                            }}
                            className={inputClass}
                          />
                          <button
                            type="button"
                            aria-label={`Remove source ${index + 1}`}
                            onClick={() =>
                              updateSources(
                                raw.sourcesOfTruth.filter(
                                  (_current, i) => i !== index,
                                ),
                              )
                            }
                            className="shrink-0 rounded-full p-2 text-[#2D1C00]/45 transition-colors hover:bg-[#2D1C00]/5 hover:text-[#2D1C00]"
                          >
                            <X className="size-4" strokeWidth={2.5} />
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-1">
                          {check?.ok ? (
                            <span
                              className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 font-mono text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200"
                              title={`Verified ${formatAsOf(
                                asOf(isoFromUnix(check.checkedAt)),
                              )}`}
                            >
                              Verified source
                            </span>
                          ) : check && !check.ok ? (
                            <span
                              role="alert"
                              className="inline-flex max-w-full items-center truncate rounded-full bg-red-50 px-2.5 py-0.5 font-mono text-[10px] font-medium text-red-700 ring-1 ring-red-200"
                              title={check.reason}
                            >
                              Not verified — {check.reason ?? "check failed"}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void onVerifySource(trimmed)}
                              disabled={checking || trimmed === ""}
                              className="inline-flex cursor-pointer items-center gap-1.5 font-sans text-[10px] font-bold uppercase tracking-[0.14em] text-[#2D1C00]/45 transition-colors hover:text-[#2D1C00] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {checking && (
                                <Loader2 className="size-3 animate-spin" />
                              )}
                              {checking ? "Checking…" : "Verify source"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => updateSources([...raw.sourcesOfTruth, ""])}
                  className="cursor-pointer mt-2 inline-flex items-center gap-1.5 font-sans font-bold text-[11px] uppercase text-[#2D1C00]/55 transition-colors hover:text-[#2D1C00]"
                >
                  <Plus className="size-3" strokeWidth={2.5} /> Add source
                </button>
                {!Object.values(sourceChecks).some((check) => check.ok) && (
                  <p className="mt-2 text-xs font-medium leading-relaxed tracking-tight text-[#2D1C00]/55">
                    A verified public source of truth is required before you
                    can continue.
                  </p>
                )}
              </div>

              <div>
                <span id="draft-category-label" className={labelClass}>
                  Category
                </span>
                {/* Themed kit dropdown (only Select* parts — no other ui/*
                    component). Phase 3: the selected key can only be one of the
                    rendered option keys, so no off-list category can be
                    introduced; the server validators remain the authority. */}
                <Select
                  className="mt-2 w-full"
                  aria-labelledby="draft-category-label"
                  selectedKey={raw.category}
                  onSelectionChange={(key) => {
                    if (key != null) updateRaw({ category: String(key) });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((option) => (
                      <SelectItem key={option} id={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Times are defaulted; adjusted only on request (decision 3). */}
              <div>
                <button
                  type="button"
                  aria-expanded={showDates}
                  onClick={() => setShowDates((value) => !value)}
                  className="inline-flex items-center gap-1.5 font-sans text-[11px] uppercase font-bold text-[#2D1C00]/55 transition-colors hover:text-[#2D1C00]"
                >
                  {showDates ? "Hide dates" : "Adjust dates"}
                </button>
                {showDates && (
                  <div className="mt-3 grid gap-4 sm:grid-cols-3">
                    <div>
                      <label htmlFor="draft-startTime" className={labelClass}>
                        Starts
                      </label>
                      {/* Start date defaults to today and can only move
                          FORWARD: the input's min is today, a past pick is
                          refused outright (never mutates the draft — the
                          domain validator enforces the same rule), and a
                          chosen day is lifted to the lead floor so "today"
                          stays valid. */}
                      <input
                        id="draft-startTime"
                        type="date"
                        min={dateInputValue(adapters.now())}
                        value={dateInputValue(raw.startTime)}
                        onChange={(event) => {
                          const dayStart = unixFromDateInput(event.target.value);
                          if (dayStart === null) return;
                          if (dayStartOf(dayStart) < dayStartOf(adapters.now())) {
                            setStartDateError(
                              "Start date can't be before today",
                            );
                            return;
                          }
                          setStartDateError(null);
                          updateRaw({
                            startTime: effectiveStartSeconds(
                              dayStart,
                              adapters.now(),
                              startLeadSeconds,
                            ),
                          });
                        }}
                        className={`mt-2 ${inputClass}`}
                      />
                      {startDateError && (
                        <p
                          role="alert"
                          className="mt-2 text-xs font-medium text-red-700"
                        >
                          {startDateError}
                        </p>
                      )}
                      {!startDateError && opensLater && (
                        <p
                          role="note"
                          className="mt-2 text-xs font-medium leading-relaxed text-[#2D1C00]/60"
                        >
                          This market will open on {displayDate(raw.startTime)}{" "}
                          — trading won&apos;t start before that date.
                        </p>
                      )}
                    </div>
                    {(
                      [
                        ["endTime", "Ends"],
                        ["resolutionTime", "Resolves"],
                      ] as const
                    ).map(([field, label]) => (
                      <div key={field}>
                        <label
                          htmlFor={`draft-${field}`}
                          className={labelClass}
                        >
                          {label}
                        </label>
                        <input
                          id={`draft-${field}`}
                          type="date"
                          value={dateInputValue(raw[field])}
                          onChange={(event) => {
                            const next = unixFromDateInput(event.target.value);
                            if (next !== null) updateRaw({ [field]: next });
                          }}
                          className={`mt-2 ${inputClass}`}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-start">
                <Pill onClick={onContinueDraft} busy={busy}>
                  Continue
                </Pill>
              </div>

              {draftActive && <ErrorPanel error={error} />}
            </div>
          </Section>
        )}

        {/* 03 — Resolve */}
        {resolveReached && raw && (
          <Section
            index={3}
            title="Resolve"
            state={resolveActive ? "active" : "done"}
            summary={!resolveActive ? "Marked resolvable" : undefined}
            onEdit={!resolveActive ? onRevise : undefined}
          >
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-relaxed tracking-tight text-[#2D1C00]/70">
                This draft has a verified public source of truth and a rule
                specific enough to resolve. The next step opens Panta&apos;s
                quote — the source is re-checked right before the quote so it
                can&apos;t have silently gone away.
              </p>
              <div>
                <Pill onClick={onOpenQuote} busy={busy}>
                  Open quote
                </Pill>
              </div>
              {resolveActive && <ErrorPanel error={error} />}
            </div>
          </Section>
        )}

        {/* 04 — Quote */}
        {quoteReached && (
          <Section
            index={4}
            title="Quote"
            state="active"
            summary={
              status === "quoted"
                ? "Fee from Panta"
                : "Expired — review your draft"
            }
          >
            {status === "quoted" && lifecycle?.status === "quoted" ? (
              <QuoteSlip
                quote={lifecycle.quote}
                readAt={asOf(isoFromUnix(adapters.now()))}
                provenance={adapters.provenance}
              />
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm leading-relaxed tracking-tight text-[#2D1C00]/70">
                  The quote expired before you signed. Nothing was charged —
                  revise the draft to get a fresh fee.
                </p>
                <div>
                  <Pill onClick={onRevise}>Back to draft</Pill>
                </div>
              </div>
            )}
          </Section>
        )}

        {/* 05 — Sign (gated; hard stop on signing) */}
        {status === "quoted" && (
          <Section index={5} title="Sign" state="active">
            <SignStepButton />
            <p className="mt-3 text-xs leading-relaxed tracking-tight text-[#2D1C00]/50">
              Connecting links your wallet. Live signing is still disabled — no
              transaction is built or signed, and no market is registered.
            </p>
          </Section>
        )}

        {/* Terminal / start-over fallback (fail-closed) */}
        {(status === "failed" || status === "duplicate_market") && (
          <Section index={5} title="Stopped" state="active">
            <p className="text-sm leading-relaxed tracking-tight text-[#2D1C00]/70">
              This flow stopped before anything was signed. You can start over
              with the same claim.
            </p>
            <div className="mt-4">
              <Pill onClick={onStartOver}>Start over</Pill>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
};

/** An editorial step section — a numeral + title rule, no card stack. */
const Section = ({
  index,
  title,
  state,
  summary,
  onEdit,
  children,
}: {
  index: number;
  title: string;
  state: StageState;
  summary?: ReactNode;
  onEdit?: () => void;
  children: ReactNode;
}) => (
  <section
    aria-label={title}
    className="border-t border-[#2D1C00]/10 pt-6 first:border-t-0 first:pt-0"
  >
    <div className="flex items-baseline justify-between gap-4">
      <div className="flex items-baseline gap-3">
        <span
          className={`font-tusker-6700 text-xs tracking-[0.2em] ${
            state === "locked" ? "text-[#2D1C00]/30" : "text-[#2D1C00]/50"
          }`}
        >
          {String(index).padStart(2, "0")}
        </span>
        <h2
          className={`font-tusker-9800 text-2xl tracking-tight ${
            state === "locked" ? "text-[#2D1C00]/35" : "text-[#2D1C00]"
          }`}
        >
          {title}
        </h2>
      </div>
      {state === "done" && onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="cursor-pointer inline-flex items-center gap-1.5 font-sans text-[11px] uppercase font-bold text-[#2D1C00]/50 transition-colors hover:text-[#2D1C00]"
        >
          <Pencil className="size-3" strokeWidth={2.5} /> Edit
        </button>
      )}
    </div>
    {state === "active" ? (
      <div className="mt-4">{children}</div>
    ) : summary != null ? (
      typeof summary === "string" ? (
        <p className="mt-2 line-clamp-2 font-tusker-6700 text-xs leading-relaxed text-[#2D1C00]/55">
          {summary}
        </p>
      ) : (
        <div className="mt-2">{summary}</div>
      )
    ) : null}
  </section>
);

const Pill = ({
  onClick,
  busy = false,
  children,
}: {
  onClick: () => void;
  busy?: boolean;
  children: ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={busy}
    className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#2D1C00] px-5 py-2.5 text-sm font-semibold tracking-tight text-[#FFF2DD] transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
  >
    {busy && <Loader2 className="size-4 animate-spin" />}
    {children}
  </button>
);

/**
 * Parse a source URL down to its host for display (Phase 3: never throws into
 * render — a malformed source falls back to the raw string, and the value is
 * only ever placed as React text, so a hostile URL cannot become markup).
 */
const sourceHost = (value: string): string => {
  try {
    return new URL(value).hostname || value;
  } catch {
    return value;
  }
};

/**
 * The draft's spec — the market's shape (category · schedule · sources)
 * rendered with the same vocabulary as the market detail page's meta row: a
 * chip, a schedule timeline with nodes, and source chips. Shared by the
 * expanded editor (as a live preview) and the collapsed review so the two can
 * never disagree — both read `raw` directly, the same object the validators
 * consume.
 */
const DraftSpec = ({ raw }: { raw: RawDraft }) => {
  const sources = raw.sourcesOfTruth.filter((s) => s.trim().length > 0);
  const schedule = [
    { label: "Opens", at: raw.startTime },
    { label: "Closes", at: raw.endTime },
    { label: "Resolves", at: raw.resolutionTime },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[#2D1C00] px-3 py-1 font-tusker-6700 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#FFF2DD]">
          {raw.category.trim() || "Uncategorised"}
        </span>
        <span className="rounded-full bg-[#2D1C00]/10 px-3 py-1 font-mono text-[11px] font-medium tracking-tight text-[#2D1C00]/60">
          {sources.length} {sources.length === 1 ? "source" : "sources"}
        </span>
      </div>

      <ol className="grid grid-cols-3">
        {schedule.map((node, index) => (
          <li key={node.label} className="relative text-center">
            <span
              aria-hidden="true"
              className={`absolute top-[4px] h-px bg-[#2D1C00]/15 ${
                index === 0
                  ? "left-1/2 right-0"
                  : index === schedule.length - 1
                    ? "left-0 right-1/2"
                    : "left-0 right-0"
              }`}
            />
            <span className="relative mx-auto block size-2.5 rounded-full border-2 border-[#2D1C00] bg-[#FFF2DD]" />
            <span className="mt-3 block font-tusker-6700 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#2D1C00]/40">
              {node.label}
            </span>
            <span className="mt-1 block font-mono text-xs font-medium tracking-tight text-[#2D1C00]">
              {displayDate(node.at)}
            </span>
          </li>
        ))}
      </ol>

      {sources.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {sources.map((source, index) => (
            <li
              key={`${source}-${index}`}
              className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full bg-[#2D1C00]/5 px-3 py-1 font-mono text-[11px] tracking-tight text-[#2D1C00]/70"
            >
              <Link2 className="size-3 shrink-0 text-[#2D1C00]/40" strokeWidth={2.5} />
              <span className="truncate">{sourceHost(source)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** The resolution rule as a left-rule pull quote (matches the market page). */
const DraftRule = ({ rule }: { rule: string }) => (
  <div className="border-l-2 border-[#2D1C00]/15 pl-5">
    <p className="font-tusker-6700 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#2D1C00]/40">
      Resolution rule
    </p>
    <p className="mt-2 text-sm font-medium leading-relaxed tracking-tight text-[#2D1C00]/75">
      {rule}
    </p>
  </div>
);

/** Renders every CreateMarketError variant honestly; never a raw throw. */
const ErrorPanel = ({ error }: { error: CreateMarketError | null }) => {
  if (!error) return null;

  if (error.kind === "unverified_source") {
    return (
      <div
        role="alert"
        className="mt-4 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200"
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-900/70">
          Verified source required
        </p>
        <p className="mt-1 text-sm font-medium leading-relaxed text-amber-900">
          {error.checks.length === 0
            ? "Add at least one public source of truth, then verify it."
            : "Continuing needs at least one verified source of truth. Every source must check out:"}
        </p>
        {error.checks.length > 0 && (
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed">
            {error.checks.map((check) => (
              <li key={check.url} className="flex flex-col">
                <span className="font-mono text-xs text-amber-900/80">
                  {check.url}
                </span>
                <span
                  className={check.ok ? "text-emerald-700" : "text-red-700"}
                >
                  {check.ok ? "verified" : check.reason ?? "not verified"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (error.kind === "unresolvable") {
    return (
      <div className="mt-4 rounded-xl bg-[#2D1C00]/5 p-4 ring-1 ring-[#2D1C00]/10">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#2D1C00]/60">
          Not resolvable yet
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-sm leading-relaxed text-[#2D1C00]/75">
          {error.report.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        {error.report.suggestions.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm leading-relaxed text-[#2D1C00]/55">
            {error.report.suggestions.map((suggestion) => (
              <li key={suggestion}>→ {suggestion}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const message =
    error.kind === "validation"
      ? error.errors.map((field) => `${field.field}: ${field.message}`).join(" · ")
      : error.kind === "adapter"
        ? error.message
        : `unexpected step (${error.from} → ${error.to})`;

  return (
    <p
      role="alert"
      className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium leading-relaxed text-red-800 ring-1 ring-red-200"
    >
      {message}
    </p>
  );
};

const SlipRow = ({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) => (
  <div className="flex items-baseline gap-2">
    <dt className="shrink-0 font-medium text-[#2D1C00]/60">{label}</dt>
    <span
      aria-hidden="true"
      className="mb-1 min-w-4 flex-1 border-b border-dotted border-[#2D1C00]/25"
    />
    <dd className="text-right">
      <span className="font-mono font-medium text-[#2D1C00]">{value}</span>
      {note && (
        <span className="block font-mono text-[10px] text-[#2D1C00]/45">
          {note}
        </span>
      )}
    </dd>
  </div>
);

/**
 * The quote — a receipt-style slip. Every figure comes from the adapter quote
 * (the sole fee authority); no literal is written here.
 */
const QuoteSlip = ({
  quote,
  readAt,
  provenance,
}: {
  quote: CreateQuote;
  readAt: AsOf;
  provenance: DataProvenance;
}) => {
  const fee = feeDisclosure("creation", "Creation fee", quote.paymentUsdc, readAt);
  return (
    <section
      aria-label="Create quote"
      className="rounded-2xl bg-[#2D1C00]/5 p-5 shadow-[0_1px_0_rgba(45,28,0,0.05)] md:p-6"
    >
      <div className="flex items-center justify-between">
        <p className="font-tusker-6700 text-[11px] font-medium uppercase tracking-[0.22em] text-[#2D1C00]/50">
          Create quote
        </p>
        <span className="font-tusker-6700 text-[11px] uppercase tracking-[0.18em] text-[#2D1C00]/40">
          {provenance === "fixture" ? "preview data" : "live"}
        </span>
      </div>

      <dl className="mt-4 space-y-2.5 text-sm">
        <SlipRow
          label={fee.label}
          value={formatUsdc(fee.amountUsdc)}
          note={`fee as of ${formatAsOf(fee.shownAt)}`}
        />
        <SlipRow
          label="Liquidity injection"
          value={formatUsdc(quote.liquidityInjectionUsdc)}
        />
        <SlipRow
          label="Platform revenue"
          value={formatUsdc(quote.platformRevenueUsdc)}
        />
      </dl>

      <p className="mt-3 font-mono text-[10px] tracking-tight text-[#2D1C00]/45">
        quote expires {formatAsOf(asOf(isoFromUnix(quote.expiresAt)))} · only
        Panta&apos;s quote sets the fee
      </p>

      <div className="mt-4 flex items-center justify-between border-t border-[#2D1C00]/10 pt-3">
        <PantaBadge />
        <span className="font-mono text-[10px] tracking-tight text-[#2D1C00]/40">
          as of {formatAsOf(readAt)}
        </span>
      </div>
    </section>
  );
};
