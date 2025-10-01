/* eslint curly: ["error", "all"] */
// src/components/ScoreOSMD.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";

/* ---------- Props & Types ---------- */

interface Props {
  src: string;
  fillParent?: boolean; // default: true
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  topGutterPx?: number; // default: 3 (small white space at very top)
  debugShowAllMeasureNumbers?: boolean; // default: false (dev aid)
}

interface Band { top: number; bottom: number; height: number }

// Type: function stored in a ref
type ReflowCallback = () => Promise<void>;

// Central pagination/masking knobs (tuned for Hi/Lo DPR). Change here, not inline.
const REFLOW = {
  // Width used for OSMD's layout (computed from container width / zoom, then clamped)
  MIN_LAYOUT_W: 320,
  MAX_LAYOUT_W: 1600,
  WIDTH_NUDGE: -1,           // small bias to avoid edge-case layouts

  // Pagination height slop: lets us fill the page slightly past the visible height
  PAGE_FILL_SLOP_PX: 8,

  // “Last page” spacing: if a system is too close to the bottom, push it to a new page
  LAST_PAGE_BOTTOM_PAD_PX: 12,

  // Masking/peek guards between pages (don’t usually need to touch)
  MASK_BOTTOM_SAFETY_PX: 12,
  PEEK_GUARD_LO_DPR: 5,
  PEEK_GUARD_HI_DPR: 7,

  // Fixed bottom cutter padding
  BOTTOM_PEEK_PAD_LO_DPR: 5,
  BOTTOM_PEEK_PAD_HI_DPR: 6,
} as const;

// Allow up to 3 recursive passes of applyPage to settle layout.
// Bail on the 4th to prevent oscillation.
const APPLY_MAX_PASSES = 3 as const;

async function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(tag)), ms);
    p.then(v => { window.clearTimeout(t); resolve(v); },
      e => { window.clearTimeout(t); reject(e); });
  });
}

// Await OSMD.load(...) whether it returns void or a Promise.
// (No "maybe" checks needed.)
async function awaitLoad(
  osmd: OpenSheetMusicDisplay,
  input: string | Document | ArrayBuffer | Uint8Array
): Promise<void> {
  type LoadInput = string | Document | ArrayBuffer | Uint8Array;
  type OSMDHasLoad = { load: (i: LoadInput) => void | Promise<unknown> };

  const o = osmd as unknown as OSMDHasLoad;
  await Promise.resolve(o.load(input));
}

// --- Instance-scoped afterPaint factory (safe for multiple components) ---
function makeAfterPaint(outer: HTMLDivElement) {
  return function afterPaintLocal(label?: string, timeoutMs = 300): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const t0 =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();

      function finish(
        why: "raf" | "timeout" | "hidden" | "message" | "safety-tick" | "ceiling"
      ): void {
        if (done) { return; }
        done = true;
        try {
          // Keep lightweight breadcrumbs for debugging
          outer.dataset.osmdAfterpaint = `${label ?? ""}:${why}`;
          const now =
            typeof performance !== "undefined" && typeof performance.now === "function"
              ? performance.now()
              : Date.now();
          const ms = Math.round(now - t0);
          outer.dataset.osmdAfterpaintMs = String(ms);

          void logStep(`[ap] ${label ?? ""} -> ${why} (${ms}ms)`);
        } catch { }
        resolve();
      }
      try {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => finish("raf"));
        });
      } catch { }

      // Primary watchdog: if rendering takes longer than timeoutMs, force-finish
      window.setTimeout(() => finish("timeout"), timeoutMs);

      // Ceiling guard: absolute upper bound (4× timeout or 1200ms minimum)
      // prevents spinner from hanging forever in edge cases
      window.setTimeout(() => finish("ceiling"), Math.max(timeoutMs * 4, 1200));
    });
  };
}

function getSvg(outer: HTMLDivElement): SVGSVGElement | null {
  return outer.querySelector("svg");
}

function withUntransformedSvg<T>(outer: HTMLDivElement, fn: (svg: SVGSVGElement) => T): T | null {
  const svg = getSvg(outer);
  if (!svg) {
    return null;
  }
  const prev = svg.style.transform;
  const prevOrigin = svg.style.transformOrigin;
  svg.style.transform = "none";
  svg.style.transformOrigin = "top left";
  try {
    return fn(svg);
  } finally {
    svg.style.transform = prev;
    svg.style.transformOrigin = prevOrigin;
  }
}

/** Best-effort "wait until the browser can paint" (bounded) */
async function waitForPaint(timeoutMs = 450): Promise<void> {
  try {
    await new Promise<void>(r => window.setTimeout(r, 0)); // macrotask
    if (document.visibilityState === 'visible') {
      await Promise.race([
        new Promise<void>(r =>
          window.requestAnimationFrame(() =>
            window.requestAnimationFrame(() => r())
          )
        ),
        new Promise<void>(r => window.setTimeout(r, timeoutMs)),
      ]);
    }
  } catch { }
}

// Flip this to disable all on-page logging in one place.
const DEBUG_LOG = true;

export async function logStep(
  message: string,
  opts: { paint?: boolean; outer?: HTMLDivElement | null } = {}
): Promise<void> {
  if (!DEBUG_LOG) { return; }

  const { paint = false, outer = null } = opts;

  // ---- Fixed column widths (tweak as needed) ----
  const FN_COL = 32;
  // You suggested 8 for phase; note some phases like "post-render-prepare" are longer
  // and will be cleanly truncated to 8 here.
  const PHASE_COL = 8;

  // Local helper: truncate to the column width and pad to that width.
  const pad = (s: string, w: number): string =>
    (s.length > w ? s.slice(0, w) : s).padEnd(w, " ");

  try {
    // Prefer provided wrapper; otherwise find our wrapper element by data attribute.
    let fn = "(none)";
    let phase = "(none)";
    const wrap: HTMLElement | null =
      outer ??
      (typeof document !== "undefined"
        ? document.querySelector<HTMLElement>('[data-osmd-wrapper="1"]')
        : null);

    if (wrap) {
      const df = wrap.dataset?.osmdFunc;
      const dp = wrap.dataset?.osmdPhase;
      if (typeof df === "string" && df.length > 0) { fn = df; }
      if (typeof dp === "string" && dp.length > 0) { phase = dp; }
    }

    // Always render both columns with fixed widths.
    const fnChunk = `[${pad(fn === "(none)" ? "" : fn, FN_COL)}]`;
    const phaseChunk = `[${pad(phase === "(none)" ? "" : phase, PHASE_COL)}]`;

    const composed = `${fnChunk} ${phaseChunk} ${message}`;

    // eslint-disable-next-line no-console
    console.log(composed);

    if (wrap) {
      wrap.dataset.osmdLastLog = `${Date.now()}:${composed.slice(0, 80)}`;
    }

    if (paint) {
      await waitForPaint();
    }
  } catch { }
}
/** Wait for web fonts to be ready (bounded; prevents rare long hangs) */
async function waitForFonts(): Promise<void> {
  try {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) {
      await Promise.race([
        fonts.ready,
        new Promise<void>(resolve => window.setTimeout(resolve, 1500)),
      ]);
    }
  } catch {
    /* no-op */
  }
}

/** Track the *visible* viewport height (accounts for mobile URL/tool bars) */
function useVisibleViewportHeight() {
  const vpRef = useRef<number>(0);
  const [, force] = React.useReducer((x: number) => x + 1, 0);


  useEffect(() => {
    const update = () => {
      // prefer visualViewport when available, otherwise fall back to doc height
      const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
      const vvH = vv ? Math.floor(vv.height) : 0;
      const docH = Math.floor(document.documentElement?.clientHeight || 0);
      const h = (vvH && vvH > 0) ? vvH : docH;
      if (h && h !== vpRef.current) {
        vpRef.current = h;
        force();
      }
    };
    update();

    // visualViewport when present
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);

    // always also listen to window.resize (desktop / Safari / VV quirks)
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return vpRef; // latest visible height in px
}

// Heuristics to improve first-page layout and prevent system splitting on phones
function dynamicBandGapPx(outer: HTMLDivElement): number {
  const h = outer.clientHeight || 0;
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
  let gap = 18;            // base
  if (h <= 750) {
    gap += 6;
  }  // small visible height => merge more
  if (dpr >= 2) {
    gap += 4;
  }  // high-DPR rounding safety
  return gap;
}

function isTitleLike(first: Band | undefined, rest: Band[]): boolean {
  if (!first || rest.length === 0) {
    return false;
  }
  const sample = rest
    .slice(0, Math.min(5, rest.length))
    .map((b) => b.height)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (sample.length === 0) {
    return false;
  }
  const idx = Math.floor(sample.length / 2);
  const median = sample[idx];
  if (median === undefined) {
    return false;
  } // handles strict noUncheckedIndexedAccess
  return first.height < Math.max(36, 0.6 * median);
}

function scanSystemsPx(outer: HTMLDivElement, svgRoot: SVGSVGElement): Band[] {
  const prevFuncTag = outer.dataset.osmdFunc ?? "";
  outer.dataset.osmdFunc = "scanSystemsPx";

  try {
    void logStep("enter", { outer }); // one breadcrumb so calls are visible

    const pageRoots = Array.from(
      svgRoot.querySelectorAll<SVGGElement>(
        'g[id^="osmdCanvasPage"], g[id^="Page"], g[class*="Page"], g[class*="page"]'
      )
    );
    const roots: Array<SVGGElement | SVGSVGElement> = pageRoots.length ? pageRoots : [svgRoot];

    const hostTop = outer.getBoundingClientRect().top;

    interface Box { top: number; bottom: number; height: number; width: number }
    const boxes: Box[] = [];
    const MIN_H = 2;
    const MIN_W = 8;

    for (const root of roots) {
      const allG = Array.from(root.querySelectorAll<SVGGElement>("g"));
      for (const g of allG) {
        try {
          const r = g.getBoundingClientRect();
          if (!Number.isFinite(r.top) || !Number.isFinite(r.height) || !Number.isFinite(r.width)) { continue; }
          if (r.height < MIN_H) { continue; }
          if (r.width < MIN_W) { continue; }

          boxes.push({
            top: r.top - hostTop,
            bottom: r.bottom - hostTop,
            height: r.height,
            width: r.width,
          });
        } catch { }
      }
    }

    boxes.sort((a, b) => a.top - b.top);

    const GAP = dynamicBandGapPx(outer);
    const bands: Band[] = [];
    for (const b of boxes) {
      const last = bands.length ? bands[bands.length - 1] : undefined;
      if (!last || b.top - last.bottom > GAP) {
        bands.push({ top: b.top, bottom: b.bottom, height: b.height });
      } else {
        last.top = Math.min(last.top, b.top);
        last.bottom = Math.max(last.bottom, b.bottom);
        last.height = last.bottom - last.top;
      }
    }

    void logStep(`exit bands=${bands.length}`, { outer });
    return bands;
  } finally {
    try { outer.dataset.osmdFunc = prevFuncTag; } catch { }
  }
}

/** Compute page start *indices* so each page shows only full systems */
function computePageStartIndices(outer: HTMLDivElement, bands: Band[], viewportH: number): number[] {
  const prevFuncTag = outer.dataset.osmdFunc ?? "";
  outer.dataset.osmdFunc = "computePageStartIndices";

  try {
    void logStep("enter", { outer });

    if (bands.length === 0 || viewportH <= 0) {
      void logStep("exit starts=1 (fallback [0])", { outer });
      return [0];
    }

    const starts: number[] = [];
    let i = 0;
    const fuseTitle = isTitleLike(bands[0], bands.slice(1));

    while (i < bands.length) {
      const current = bands[i]!;
      const startTop = current.top;
      let last = i;

      while (last + 1 < bands.length) {
        const next = bands[last + 1]!;
        const isFirstPage = starts.length === 0 && i === 0;
        const slack = isFirstPage && fuseTitle
          ? Math.min(28, Math.round(viewportH * 0.035))
          : 0;

        if (next.bottom - startTop <= viewportH + slack) {
          last++;
        } else {
          break;
        }
      }

      starts.push(i);
      i = last + 1;
    }

    const out = starts.length ? starts : [0];
    void logStep(`exit starts=${out.length}`, { outer });
    return out;
  } finally {
    try { outer.dataset.osmdFunc = prevFuncTag; } catch { }
  }
}

function hasZoomProp(o: unknown): o is { Zoom: number } {
  if (typeof o !== "object" || o === null) { return false; }
  const maybe = o as { Zoom?: unknown };
  return typeof maybe.Zoom === "number";
}

function perfMark(n: string) { try { performance.mark(n); } catch { } }

function perfMeasure(n: string, a: string, b: string) {
  try { performance.measure(n, { start: a, end: b }); } catch { }
}

function perfLastMs(name: string) {
  const e = performance.getEntriesByName(name);
  return Math.round(e[e.length - 1]?.duration || 0);
}

// --------- Perf blocks (module-scope; reusable) ---------
function perfBlock<T>(
  uid: string,
  work: () => T,
  after?: (ms: number) => void
): T {
  const start = `${uid} start`;
  const end = `${uid} end`;
  const runtime = `${uid} runtime`;
  perfMark(start);
  try {
    return work();
  } finally {
    perfMark(end);
    perfMeasure(runtime, start, end);
    const ms = perfLastMs(runtime);
    try { after?.(ms); } catch { }
    try {
      performance.clearMarks(start);
      performance.clearMarks(end);
      performance.clearMeasures(runtime);
    } catch { }
  }
}

async function perfBlockAsync<T>(
  uid: string,
  work: () => Promise<T>,
  after?: (ms: number) => void
): Promise<T> {
  const start = `${uid} start`;
  const end = `${uid} end`;
  const runtime = `${uid} runtime`;
  perfMark(start);
  try {
    return await work();
  } finally {
    perfMark(end);
    perfMeasure(runtime, start, end);
    const ms = perfLastMs(runtime);
    try { after?.(ms); } catch { }
    try {
      performance.clearMarks(start);
      performance.clearMarks(end);
      performance.clearMeasures(runtime);
    } catch { }
  }
}

/* ---------- Component ---------- */

export default function ScoreOSMD({
  src,
  fillParent = true,
  height = 600,
  className = "",
  style,
  topGutterPx = 3, // small white strip at the very top
  debugShowAllMeasureNumbers = false,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);

  const bandsRef = useRef<Band[]>([]);
  const pageStartsRef = useRef<number[]>([0]);
  const pageIdxRef = useRef<number>(0);
  const readyRef = useRef<boolean>(false);

  const DEFAULT_BUSY = "Please wait…";

  // Busy lock (blocks input while OSMD works)
  const [busy, setBusy] = useState<boolean>(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [busyMsg, setBusyMsg] = useState<string>(DEFAULT_BUSY);

  // Spinner ownership + fail-safe timer (used by zoom reflow)
  const spinnerOwnerRef = useRef<symbol | null>(null);
  const spinnerFailSafeRef = useRef<number | null>(null);

  // Debounce + reentry guards for resize/viewport changes
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  // Monotonic UID for perf blocks within this component instance
  const instanceIdRef = useRef<string>(`osmd-${Math.random().toString(36).slice(2, 8)}`);
  const perfSeqRef = useRef(0);
  const nextPerfUID = useCallback((run: string | number | undefined) => {
    perfSeqRef.current += 1;
    return `${instanceIdRef.current}#${run ?? "?"}@${perfSeqRef.current}`;
  }, []);

  // --- Init watchdog guards ---
  const initEpochRef = useRef(0);
  const initFinalizeTimerRef = useRef<number | null>(null);

  const vvTimerRef = useRef<number | null>(null);     // visualViewport debounce

  const handledWRef = useRef<number>(-1);
  const handledHRef = useRef<number>(-1);

  // add near handledWRef/handledHRef
  const reflowRunningRef = useRef(false);   // guards width reflow
  const reflowAgainRef = useRef<"none" | "width" | "height">("none");
  const reflowQueuedCauseRef = useRef<string>("");   // ← remember why a reflow was queued
  const repagRunningRef = useRef(false);    // guards height-only repagination

  // Track browser zoom relative to mount
  const baseScaleRef = useRef<number>(1);
  const zoomFactorRef = useRef<number>(1);

  const computeZoomFactor = useCallback((): number => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    const scaleNow = (vv && typeof vv.scale === "number") ? vv.scale : (window.devicePixelRatio || 1);
    const base = baseScaleRef.current || 1;
    const raw = scaleNow / base;
    if (!Number.isFinite(raw) || raw <= 0) { return 1; }
    // Clamp to a sane range so weird browser values don’t explode layout
    return Math.max(0.5, Math.min(3, raw));
  }, []);

  const applyZoomFromRef = useCallback((): void => {
    const inst = osmdRef.current;
    if (!inst) { return; }

    const z = zoomFactorRef.current;
    if (typeof z !== "number" || !Number.isFinite(z)) { return; }

    const clamped = Math.max(0.5, Math.min(3, z));

    // Only touch Zoom if the instance actually exposes it
    if (hasZoomProp(inst)) {
      const curr = inst.Zoom;
      if (!Number.isFinite(curr) || Math.abs(curr - clamped) > 0.001) {
        try { inst.Zoom = clamped; } catch { }
      }
    }
  }, []);

  // --- WIDTH-SANDBOXED RENDER (safe) ---
  const renderWithEffectiveWidth = useCallback(
    async (
      outer: HTMLDivElement,
      osmd: OpenSheetMusicDisplay
    ): Promise<void> => {
      const host = hostRef.current;
      if (!host || !outer) { return; }

      const prevFuncTag = outer.dataset.osmdFunc ?? "";
      outer.dataset.osmdFunc = "renderWithEffectiveWidth";
      await logStep("enter", { outer });

      // Use our zoom source of truth
      applyZoomFromRef();
      const zf = Math.min(3, Math.max(0.5, zoomFactorRef.current || 1));

      const hostW = Math.max(1, Math.floor(outer.clientWidth));
      const rawLayoutW = Math.max(1, Math.floor(hostW / zf));

      // Tiny nudge helps avoid width-specific edge cases
      const widthNudge = REFLOW.WIDTH_NUDGE;
      const MAX_LAYOUT_W = REFLOW.MAX_LAYOUT_W;
      const MIN_LAYOUT_W = REFLOW.MIN_LAYOUT_W;
      const layoutW = Math.max(MIN_LAYOUT_W, Math.min(rawLayoutW + widthNudge, MAX_LAYOUT_W));

      outer.dataset.osmdZf = String(zf);
      outer.dataset.osmdLayoutW = String(layoutW);

      // Heartbeat so you can see progress even if render is slow
      const startedAt = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      const beat = window.setInterval(() => {
        const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        const secs = Math.round((now - startedAt) / 1000);
        void logStep(`render:heartbeat +${secs}s`);
      }, 1000);

      try {
        // Style sandbox: let width drive layout just for this call
        host.style.left = "0";
        host.style.right = "auto";
        host.style.width = `${layoutW}px`;
        void host.getBoundingClientRect(); // ensure style applies this frame

        // NEW: let the spinner/host actually paint before we block the main thread
        await waitForPaint(300);

        await logStep(`w=${layoutW} hostW=${hostW} zf=${zf.toFixed(3)} osmd.Zoom=${osmd.Zoom ?? "n/a"}`);

        // NEW: mark + measure the synchronous render
        try { performance.mark("osmd-render:start"); } catch { }
        osmd.render(); // synchronous & heavy
        try {
          performance.mark("osmd-render:end");
          performance.measure("osmd-render", "osmd-render:start", "osmd-render:end");
        } catch { }
      } catch (e) {
        void logStep(`render:error ${(e as Error)?.message ?? e}`);
        throw e;
      } finally {
        try { await logStep("exit", { outer }); } catch { }
        try { outer.dataset.osmdFunc = prevFuncTag; } catch { }

        try { window.clearInterval(beat); } catch { }
        // Always restore styles
        host.style.left = "";
        host.style.right = "";
        host.style.width = "";
        const svg = getSvg(outer);
        if (svg) { svg.style.transformOrigin = "top left"; }
      }
    },
    [applyZoomFromRef]
  );

  const hideBusy = useCallback(() => {
    setBusy(false);
    setBusyMsg(DEFAULT_BUSY);
  }, []);


  // Spinner helpers config (used by both init + reflow)
  const SPINNER_FAILSAFE_MS = 9000 as const;

  const spinBegin = useCallback(
    async (
      outer: HTMLDivElement,
      opts?: string | { message?: string; gatePaint?: boolean }
    ): Promise<void> => {
      // NEW: temporarily tag logs as coming from spinBegin
      const prevFuncTag = outer.dataset.osmdFunc ?? "";
      outer.dataset.osmdFunc = "spinBegin";
      try {
        // --- your original body starts here ---
        const msg =
          typeof opts === "string" || opts === undefined
            ? (opts ?? DEFAULT_BUSY)
            : (opts.message ?? DEFAULT_BUSY);

        const gatePaint =
          typeof opts === "object" && opts !== null
            ? Boolean(opts.gatePaint)
            : true;

        const token = Symbol("spin");
        spinnerOwnerRef.current = token;

        setBusyMsg(msg);
        setBusy(true);

        // (rest of your existing code stays exactly the same)
        if (gatePaint) {
          await new Promise<void>((r) => setTimeout(r, 0));
          if (document.visibilityState === "visible") {
            await Promise.race([
              new Promise<void>((r) => requestAnimationFrame(() => r())),
              new Promise<void>((r) => setTimeout(r, 120)),
            ]);
          }
        }

        const ov = overlayRef.current;
        const shown = !!ov && ov.style.display !== "none";
        void logStep(
          shown ? "spinner is visible" : "spinner requested (visibility pending)",
          { outer }
        );

        if (spinnerFailSafeRef.current) {
          window.clearTimeout(spinnerFailSafeRef.current);
        }
        spinnerFailSafeRef.current = window.setTimeout(() => {
          spinnerOwnerRef.current = null;
          hideBusy();
          void logStep("failsafe triggered after 9s; hiding spinner", { outer });
        }, SPINNER_FAILSAFE_MS);
        // --- your original body ends here ---
      } finally {
        // NEW: restore caller’s func tag no matter what
        try { outer.dataset.osmdFunc = prevFuncTag; } catch { /* noop */ }
      }
    },
    [hideBusy]
  );

  const spinEnd = useCallback(
    async (outer: HTMLDivElement): Promise<void> => {
      const prevFuncTag = outer.dataset.osmdFunc ?? "";
      outer.dataset.osmdFunc = "spinEnd";
      try {
        spinnerOwnerRef.current = null;
        if (spinnerFailSafeRef.current) {
          window.clearTimeout(spinnerFailSafeRef.current);
          spinnerFailSafeRef.current = null;
        }

        hideBusy();

        await new Promise<void>((r) => setTimeout(r, 0));
        if (document.visibilityState === "visible") {
          await Promise.race([
            new Promise<void>((r) => requestAnimationFrame(() => r())),
            new Promise<void>((r) => setTimeout(r, 180)),
          ]);
        }

        await logStep("spinner:end", { outer });
      } finally {
        try { outer.dataset.osmdFunc = prevFuncTag; } catch { /* noop */ }
      }
    },
    [hideBusy]
  );

  // --- LOG SNAPSHOT (lean) ---
  const fmtFlags = useCallback((): string => {
    const pages = Math.max(1, pageStartsRef.current.length);
    const page = Math.max(1, Math.min(pageIdxRef.current + 1, pages));
    const queued = reflowAgainRef.current; // "none" | "width" | "height"
    const zf = (zoomFactorRef.current ?? 1).toFixed(3);

    const parts = [`page=${page}/${pages}`, `zf=${zf}`];
    if (queued !== "none") { parts.push(`queued=${queued}`); }
    return parts.join(" ");
  }, []);

  // ---- callback ref proxies (used by queued window.setTimeouts) ----
  const reflowFnRef = useRef<ReflowCallback>(async () => { });

  const repagFnRef = useRef<() => void>(() => { });

  const vpHRef = useVisibleViewportHeight();

  const getViewportH = useCallback((outer: HTMLDivElement): number => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    const vvH = vv ? Math.floor(vv.height) : 0;
    const outerH = outer.clientHeight || 0;
    const docH = Math.floor(document.documentElement?.clientHeight || 0);

    // If VV and wrapper disagree a lot (URL/tool bars mid-animation),
    // be conservative and take the smaller so we never overfill page 1.
    let base: number;
    if (vvH && outerH && Math.abs(vvH - outerH) > 24) {
      base = Math.min(vvH, outerH);
    } else {
      base = outerH || vvH || docH;
    }

    return Math.max(1, Math.floor(base) - Math.max(0, topGutterPx));
  }, [topGutterPx]
  );

  const bottomPeekPad = useCallback(
    () => ((window.devicePixelRatio || 1) >= 2
      ? REFLOW.BOTTOM_PEEK_PAD_HI_DPR
      : REFLOW.BOTTOM_PEEK_PAD_LO_DPR),
    []
  );

  const pageHeight = useCallback(
    (outer: HTMLDivElement) => Math.max(1, getViewportH(outer) - bottomPeekPad()),
    [getViewportH, bottomPeekPad]
  );

  // --- Unify pagination height (memoized so identity is stable) ---
  const getPAGE_H = useCallback(
    (outer: HTMLDivElement) => pageHeight(outer) + REFLOW.PAGE_FILL_SLOP_PX,
    [pageHeight]
  );


  // Apply the chosen page to the viewport: translate the SVG to its start and mask/cut to hide any next-page peek.
  // May recompute page starts and re-apply to preserve whole systems; bounded recursion prevents oscillation.
  const applyPage = useCallback(
    (pageIdx: number, depth: number = 0): void => {
      const outer = wrapRef.current;
      if (!outer) { return; }

      // Temporary func tag for crisp, aligned prefixes in logs.
      const prevFuncTag = outer.dataset.osmdFunc ?? "";
      outer.dataset.osmdFunc = "applyPage";

      try {
        // Bail if recursion depth exceeds APPLY_MAX_PASSES (prevents oscillation).
        // This allows up to 3 recursive passes; the 4th would bail.
        if (depth > APPLY_MAX_PASSES) {
          outer.dataset.osmdPhase = "applyPage:bailout";
          void logStep(`bail: recursion depth>${APPLY_MAX_PASSES} at pageIdx=${pageIdx}`, { outer });
          return;
        }

        void logStep(`enter pageIdx=${pageIdx} depth=${depth}`, { outer });
        const svg = getSvg(outer);
        if (!svg) {
          return;
        }

        const bands = bandsRef.current;
        const starts = pageStartsRef.current;
        if (bands.length === 0 || starts.length === 0) {
          return;
        }

        const pages = starts.length;
        const clampedPage = Math.max(0, Math.min(pageIdx, pages - 1));
        pageIdxRef.current = clampedPage;

        const startIndex = starts[clampedPage] ?? 0;
        const startBand = bands[startIndex];
        if (!startBand) {
          return;
        }

        const ySnap = Math.ceil(startBand.top);

        svg.style.transform = `translateY(${-ySnap + Math.max(0, topGutterPx)}px)`;
        svg.style.transformOrigin = "top left";
        svg.style.willChange = "transform";

        const nextStartIndex = clampedPage + 1 < starts.length ? (starts[clampedPage + 1] ?? -1) : -1;

        const BOTTOM_PEEK_PAD = bottomPeekPad();
        const hVisible = pageHeight(outer);

        // NEW: unify all repagination to one height
        const TOL = (window.devicePixelRatio || 1) >= 2 ? 2 : 1; // tiny tolerance
        const PAGE_H = getPAGE_H(outer);                         // unified height

        // If the top of the next system is already inside the window...
        if (nextStartIndex >= 0) {
          const nextBand = bands[nextStartIndex];
          if (nextBand) {
            const nextTopRel = nextBand.top - startBand.top;

            if (nextTopRel <= hVisible - TOL) {
              const fresh = computePageStartIndices(outer, bands, PAGE_H);
              if (fresh.length) {
                // lower bound: first start >= startIndex
                let lb = fresh.length - 1;
                for (let i = 0; i < fresh.length; i++) {
                  const s = fresh[i] ?? 0;
                  if (s >= startIndex) { lb = i; break; }
                }

                const noChange =
                  fresh.length === starts.length &&
                  fresh.every((v, i) => v === (starts[i] ?? -1)) &&
                  lb === clampedPage;

                if (!noChange) {
                  pageStartsRef.current = fresh;
                  applyPage(lb, depth + 1); // ← pass recursion depth
                  return;
                }
              }
            }
          }
        }

        // --- last-page margin rule: push final system to a new page if too close ---
        const LAST_PAGE_BOTTOM_PAD_PX = REFLOW.LAST_PAGE_BOTTOM_PAD_PX;

        if (nextStartIndex < 0) { // we are on the last page
          let cutIdx = -1;

          for (let i = startIndex; i < bands.length; i++) {
            const b = bands[i];
            if (!b) { continue; }                        // TS guard: b is Band
            const relBottom = b.bottom - startBand.top; // bottom within current page

            if (relBottom > hVisible - LAST_PAGE_BOTTOM_PAD_PX) {
              cutIdx = i;
              break;
            }
          }

          if (cutIdx !== -1 && cutIdx > startIndex) {
            const freshStarts = starts.slice(0, clampedPage + 1);
            if (freshStarts[freshStarts.length - 1] !== cutIdx) {
              freshStarts.push(cutIdx);
              pageStartsRef.current = freshStarts;
            }
            applyPage(clampedPage, depth + 1);                    // ← depth+1
            return;
          }
          // If cutIdx === startIndex, the single system is taller than the page; do nothing.
        }


        // ---- stale page-starts guard: recompute if last-included doesn't fit ----

        const SAFETY = (window.devicePixelRatio || 1) >= 2 ? 12 : 10;  // roughly MASK_BOTTOM_SAFETY_PX + (PEEK_GUARD - 2), avoids edge-shave on Hi-DPR
        const assumedLastIdx = (clampedPage + 1 < starts.length)
          ? Math.max(startIndex, (starts[clampedPage + 1] ?? startIndex) - 1)
          : Math.max(startIndex, bands.length - 1);

        const assumedLast = bands[assumedLastIdx];
        const lastBottomRel = assumedLast ? (assumedLast.bottom - startBand.top) : 0;

        if (assumedLast && lastBottomRel > hVisible - SAFETY) {
          const freshStarts = computePageStartIndices(outer, bands, PAGE_H); // ← PAGE_H
          if (freshStarts.length) {
            let nearest = 0, best = Number.POSITIVE_INFINITY;
            for (let i = 0; i < freshStarts.length; i++) {
              const s = freshStarts[i] ?? 0;
              const d = Math.abs(s - startIndex);
              if (d < best) { best = d; nearest = i; }
            }
            const noChange =
              freshStarts.length === starts.length &&
              freshStarts.every((v, i) => v === (starts[i] ?? -1)) &&
              nearest === clampedPage;

            if (!noChange) {
              pageStartsRef.current = freshStarts;
              applyPage(nearest, depth + 1);                     // ← depth+1
              return;
            }
          }
        }

        // ---- masking: hide anything that belongs to the next page ----
        //const MASK_BOTTOM_SAFETY_PX = 12;
        //const PEEK_GUARD = (window.devicePixelRatio || 1) >= 2 ? 7 : 5; // was 4/3
        const MASK_BOTTOM_SAFETY_PX = REFLOW.MASK_BOTTOM_SAFETY_PX;
        const PEEK_GUARD = (window.devicePixelRatio || 1) >= 2
          ? REFLOW.PEEK_GUARD_HI_DPR
          : REFLOW.PEEK_GUARD_LO_DPR;

        const maskTopWithinMusicPx = (() => {
          // Last page → never mask; show full height
          if (nextStartIndex < 0) { return hVisible; }

          const lastIncludedIdx = Math.max(startIndex, nextStartIndex - 1);
          const lastBand = bands[lastIncludedIdx];
          const nextBand = bands[nextStartIndex];
          if (!lastBand || !nextBand) { return hVisible; }

          const relBottom = lastBand.bottom - startBand.top;
          const nextTopRel = nextBand.top - startBand.top;

          // If nothing from the next page peeks into the viewport, don't mask at all.
          if (nextTopRel >= hVisible - PEEK_GUARD - 1) { return hVisible; }

          // Otherwise, hide just the peeking sliver.
          const nudge = (window.devicePixelRatio || 1) >= 2 ? 3 : 2;
          const low = Math.ceil(relBottom) + MASK_BOTTOM_SAFETY_PX - nudge;
          const high = Math.floor(nextTopRel) - PEEK_GUARD;

          if (low > high) {
            const fresh = computePageStartIndices(outer, bands, PAGE_H);
            if (fresh.length) {
              let nearest = 0, best = Number.POSITIVE_INFINITY;
              for (let i = 0; i < fresh.length; i++) {
                const s = fresh[i] ?? 0;
                const d = Math.abs(s - startIndex);
                if (d < best) { best = d; nearest = i; }
              }
              const same =
                fresh.length === starts.length &&
                fresh.every((v, i) => v === (starts[i] ?? -1)) &&
                nearest === clampedPage;
              if (!same) {
                pageStartsRef.current = fresh;
                applyPage(nearest, depth + 1);
                return hVisible;
              }
            }
          }

          const m = Math.min(hVisible, Math.max(0, Math.max(low, Math.min(high, hVisible))));
          return Math.floor(m);
        })();

        // Breadcrumbs
        outer.dataset.osmdLastApply = String(Date.now());
        outer.dataset.osmdPage = String(pageIdxRef.current);
        outer.dataset.osmdMaskTop = String(maskTopWithinMusicPx);
        outer.dataset.osmdPages = String(pages);
        outer.dataset.osmdStarts = starts.slice(0, 12).join(',');
        outer.dataset.osmdTy = String(-ySnap + Math.max(0, topGutterPx));
        outer.dataset.osmdH = String(hVisible);

        // Single, serialized logger
        logStep(`apply page:${clampedPage + 1}/${pages} start:${startIndex} nextStart:${nextStartIndex} h:${hVisible} maskTop:${maskTopWithinMusicPx}`);

        let mask = outer.querySelector<HTMLDivElement>("[data-osmd-mask='1']");
        if (!mask) {
          mask = document.createElement("div");
          mask.dataset.osmdMask = "1";
          mask.style.position = "absolute";
          mask.style.left = "0";
          mask.style.right = "0";
          mask.style.top = "0";
          mask.style.bottom = "0";
          mask.style.background = "#fff";
          mask.style.pointerEvents = "none";
          mask.style.zIndex = "10";
          outer.appendChild(mask);
        }
        mask.style.top = `${Math.max(0, topGutterPx) + maskTopWithinMusicPx}px`;

        let bottomCutter = outer.querySelector<HTMLDivElement>("[data-osmd-bottomcutter='1']");
        if (!bottomCutter) {
          bottomCutter = document.createElement("div");
          bottomCutter.dataset.osmdBottomcutter = "1";
          Object.assign(bottomCutter.style, {
            position: "absolute",
            left: "0",
            right: "0",
            bottom: "0",
            height: `${BOTTOM_PEEK_PAD}px`,
            background: "#fff",
            pointerEvents: "none",
            zIndex: "6",
          });
          outer.appendChild(bottomCutter);
        } else {
          bottomCutter.style.height = `${BOTTOM_PEEK_PAD}px`;
        }

        let topCutter = outer.querySelector<HTMLDivElement>("[data-osmd-topcutter='1']");
        if (!topCutter) {
          topCutter = document.createElement("div");
          topCutter.dataset.osmdTopcutter = "1";
          topCutter.style.position = "absolute";
          topCutter.style.left = "0";
          topCutter.style.right = "0";
          topCutter.style.top = "0";
          topCutter.style.height = `${Math.max(0, topGutterPx)}px`;
          topCutter.style.background = "#fff";
          topCutter.style.pointerEvents = "none";
          topCutter.style.zIndex = "6";
          outer.appendChild(topCutter);
        } else {
          topCutter.style.height = `${Math.max(0, topGutterPx)}px`;
        }

        // Stop layer promotion after page is applied
        if (svg) { svg.style.willChange = "auto"; }
      } finally {
        try { outer.dataset.osmdFunc = prevFuncTag; } catch { }
      }
    },
    [pageHeight, topGutterPx, bottomPeekPad, getPAGE_H]
  );

  // Hide the SVG host while we do heavy work, then restore previous styles.
  const withHostHidden = useCallback(async <T,>(
    outer: HTMLDivElement,
    work: () => Promise<T>
  ): Promise<T> => {
    const host = hostRef.current;
    let prevVis = "";
    let prevCv = "";
    if (host) {
      prevVis = host.style.visibility || "";
      prevCv = host.style.getPropertyValue("content-visibility") || "";
      host.style.removeProperty("content-visibility");
      host.style.visibility = "hidden";
      try { void host.getBoundingClientRect().width; } catch { /* layout flush */ }
    }
    try {
      return await work();
    } finally {
      if (host) {
        if (prevCv) { host.style.setProperty("content-visibility", prevCv); }
        else { host.style.removeProperty("content-visibility"); }
        if (prevVis) { host.style.visibility = prevVis; }
        else { host.style.removeProperty("visibility"); }
      }
    }
  }, []);


  // Unified: render → scan → compute starts → apply(first page)
  // NOTE: now tags logs with [renderScanApply] and adds enter/exit breadcrumbs.
  const renderScanApply = useCallback(async (
    outer: HTMLDivElement,
    osmd: OpenSheetMusicDisplay,
    opts?: {
      gateLabel?: string;     // label for after-paint breadcrumb
      gateMs?: number;        // paint gate timeout
      doubleApply?: boolean;  // whether to applyPage(0) twice (reflow=yes, init=no)
    }
  ): Promise<{ bands: Band[]; starts: number[] }> => {
    const { gateLabel = "apply:first", gateMs = 400, doubleApply = true } = opts ?? {};

    // func-tag so log prefixes show renderScanApply instead of the caller
    const prevFuncTag = outer.dataset.osmdFunc ?? "";
    outer.dataset.osmdFunc = "renderScanApply";
    outer.dataset.osmdPhase = "render";
    await logStep("phase starting", { outer });

    try {
      const ap = makeAfterPaint(outer);

      await withHostHidden(outer, async () => {
        const uid = nextPerfUID(outer.dataset.osmdRun);
        await perfBlockAsync(
          uid,
          async () => { await renderWithEffectiveWidth(outer, osmd); },
          (ms) => {
            outer.dataset.osmdRenderMs = String(ms);
            void logStep(`renderWithEffectiveWidth() runtime: (${ms}ms)`);
          }
        );
      });

      await new Promise<void>((r) => setTimeout(r, 0)); // yield one task

      await logStep("phase finished", { outer });
      outer.dataset.osmdPhase = "scan";
      await logStep("phase starting", { outer });

      const bands = perfBlock(
        nextPerfUID(outer.dataset.osmdRun),
        () => withUntransformedSvg(outer, (svg) => scanSystemsPx(outer, svg)) ?? [],
        (ms) => { void logStep(`scanSystemsPx() runtime: (${ms}ms)`); }
      );
      outer.dataset.osmdBands = String(bands.length);
      if (bands.length === 0) {
        await logStep("0 bands — abort", { outer });
        return { bands: [], starts: [0] };
      }

      const H = getPAGE_H(outer);
      const starts = perfBlock(
        nextPerfUID(outer.dataset.osmdRun),
        () => computePageStartIndices(outer, bands, H),
        (ms) => { void logStep(`computePageStartIndices() runtime: (${ms}ms) H=${H}`); }
      );

      await logStep("phase finished", { outer });
      outer.dataset.osmdPhase = "apply";
      await logStep("phase starting", { outer });

      pageStartsRef.current = starts;
      bandsRef.current = bands;
      pageIdxRef.current = 0;

      await perfBlockAsync(
        nextPerfUID(outer.dataset.osmdRun),
        async () => {
          applyPage(0);
          await Promise.race([ap(gateLabel, gateMs), new Promise<void>((r) => setTimeout(r, gateMs))]);
          if (doubleApply) { applyPage(0); }
        },
        (ms) => { void logStep(`applyPage() runtime: (${ms}ms)`); }
      );

      await logStep(`bands=${bands.length} pages=${starts.length}`, { outer });

      return { bands, starts };

    } finally {
      try { outer.dataset.osmdFunc = prevFuncTag; } catch { }
    }
  }, [nextPerfUID, renderWithEffectiveWidth, withHostHidden, getPAGE_H, applyPage]);


  // --- HEIGHT-ONLY REPAGINATION (no OSMD re-init) ---
  const recomputePaginationHeightOnly = useCallback((): void => {
    const outer = wrapRef.current;
    if (!outer) { return; }

    // Prevent overlap
    if (repagRunningRef.current) { return; }
    repagRunningRef.current = true;

    // Preserve caller’s func/phase; make logs show this function name; keep phase blank
    const prevFuncTag = outer.dataset.osmdFunc ?? "";
    const prevPhase = outer.dataset.osmdPhase ?? "";
    outer.dataset.osmdFunc = "recomputePaginationHeightOnly";
    outer.dataset.osmdPhase = "";

    try {
      outer.dataset.osmdRecompute = String(Date.now());

      const bands = bandsRef.current;
      if (bands.length === 0) {
        void logStep("exiting: 0 bands", { outer });
        return;
      }

      const H = getPAGE_H(outer);

      // Recompute page starts for the current *unified* page height
      const starts = perfBlock(
        nextPerfUID(outer.dataset.osmdRun),
        () => computePageStartIndices(outer, bands, H),
        (ms) => { void logStep(`computePageStartIndices runtime: (${ms}ms) H=${H}`); }
      );

      pageStartsRef.current = starts;
      outer.dataset.osmdPages = String(starts.length);

      // Always reset to page 1 after repagination
      perfBlock(
        nextPerfUID(outer.dataset.osmdRun),
        () => { applyPage(0); },
        (ms) => { void logStep(`applyPage runtime: (${ms}ms)`); }
      );

    } finally {
      // Drain any queued work that accumulated while we were repaginating
      const queued = reflowAgainRef.current;
      reflowAgainRef.current = "none";
      reflowQueuedCauseRef.current = "";

      if (queued === "width") {
        setTimeout(() => { reflowFnRef.current(); }, 0);
      } else if (queued === "height") {
        setTimeout(() => { repagFnRef.current(); }, 0);
      }

      // Update “handled” height so future VV height changes compare against it
      handledHRef.current = outer.clientHeight || handledHRef.current;

      repagRunningRef.current = false;

      // Restore caller’s func/phase so subsequent logs tag correctly
      outer.dataset.osmdFunc = prevFuncTag;
      outer.dataset.osmdPhase = prevPhase;
    }
  }, [applyPage, getPAGE_H, nextPerfUID]);


  // keep ref pointing to latest repagination callback
  useEffect(() => {
    repagFnRef.current = recomputePaginationHeightOnly;
  }, [recomputePaginationHeightOnly]);


  // Handle a Visual Viewport width change by executing an osmd.render and a re-pagination
  const reflowOnWidthChange = useCallback(
    async function reflowOnWidthChange(): Promise<void> {
      const outer = wrapRef.current;
      const osmd = osmdRef.current;

      if (!outer) {
        console.warn("[reflowOnWidthChange][prep] early-bail outer=0 osmd=" + (osmd ? "1" : "0"));
        return;
      }

      // Tag this path and set initial phase so logStep prefixes are correct.
      const prevFuncTag = outer.dataset.osmdFunc ?? "";
      outer.dataset.osmdFunc = "reflowOnWidthChange";

      outer.dataset.osmdPhase = "prep";
      await logStep("phase starting", { outer });

      let started = false;

      try {
        if (!osmd) {
          void logStep("early-bail outer=1 osmd=0");
          return; // finally will restore prevFuncTag
        }

        if (reflowRunningRef.current) {
          reflowAgainRef.current = "width";
          const run = Number(outer.dataset.osmdRun || "0");
          outer.dataset.osmdReflowQueued = String(run);
          outer.dataset.osmdReflowQueueWhy = "reflowRunning";
          outer.dataset.osmdReflowQueuedAt = String(Date.now());
          void logStep("reflow already in progress; queued follow-up");
          return;
        }

        started = true;

        reflowRunningRef.current = true;

        const run = (Number(outer.dataset.osmdRun || "0") + 1);
        outer.dataset.osmdRun = String(run);
        void logStep(`run# ${run} • ${fmtFlags()}`);

        const currW = outer.clientWidth;
        const currH = outer.clientHeight;
        handledWRef.current = currW; // prime "handled" now, not only at the end
        handledHRef.current = currH;

        try {
          outer.dataset.osmdReflowTargetW = String(currW);
          outer.dataset.osmdReflowTargetH = String(currH);
        } catch { }

        await spinBegin(outer, { message: DEFAULT_BUSY, gatePaint: true });

        await logStep("phase finished", { outer });

        const { bands, starts } = await renderScanApply(outer, osmd, {
          gateLabel: "one paint opportunity after first apply",
          gateMs: 400,
          doubleApply: true,
        });
        outer.dataset.osmdBands = String(bands.length);
        outer.dataset.osmdPages = String(starts.length);

      } finally {
        if (started) {
          try { outer.dataset.osmdPhase = "finally"; } catch { }
          await logStep("phase starting", { outer });

          // we finished a run; drop the guard before hiding spinner
          reflowRunningRef.current = false;

          // spinner end + small paint gate
          await spinEnd(outer);

          // clear breadcrumbs
          outer.dataset.osmdReflowTargetW = "";
          outer.dataset.osmdReflowTargetH = "";

          // drain any queued work
          const queued = reflowAgainRef.current;
          const cause = reflowQueuedCauseRef.current || "drain:finally";
          reflowAgainRef.current = "none";
          reflowQueuedCauseRef.current = "";

          if (queued === "width") {
            await logStep(`draining queued width reflow (cause=${cause})`);
            setTimeout(() => { reflowFnRef.current(); }, 0);
          } else if (queued === "height") {
            await logStep(`draining queued height repagination (cause=${cause})`);
            setTimeout(() => { repagFnRef.current(); }, 0);
          }

          await logStep("phase finished", { outer });
        }
        try { outer.dataset.osmdFunc = prevFuncTag; } catch { }
      }

    },
    [renderScanApply, fmtFlags, spinBegin, spinEnd]
  );

  // keep ref pointing to latest width-reflow callback
  useEffect(() => {
    reflowFnRef.current = reflowOnWidthChange;
  }, [reflowOnWidthChange]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) { return; }

    el.dataset.osmdProbeMounted = "1";
  }, []);

  // Record baseline zoom/scale at mount (used to compute relative zoom later)
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    const initial = (vv && typeof vv.scale === "number") ? vv.scale : (window.devicePixelRatio || 1);
    baseScaleRef.current = initial || 1;
    zoomFactorRef.current = 1;
  }, []);

  // Reflow only for actual zoom; never start immediately, just queue safely.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;

    let lastScale = vv?.scale ?? 1;
    let lastDpr = window.devicePixelRatio || 1;
    let kick: number | null = null;

    const schedule = (why: "vv-scale" | "dpr") => {
      // Ignore before first layout is fully ready
      if (!readyRef.current) {
        void logStep(`zoom:ignored (pre-ready) reason=${why}`);
        return;
      }

      // Debounce a burst of zoom changes
      if (kick !== null) { window.clearTimeout(kick); }
      kick = window.setTimeout(() => {
        kick = null;

        const before = zoomFactorRef.current;
        zoomFactorRef.current = computeZoomFactor();

        // Only act if zoom actually changed
        if (Math.abs(zoomFactorRef.current - before) < 0.003) { return; }

        void logStep(`zoom:debounced zf=${zoomFactorRef.current.toFixed(3)} reason=${why}`);

        // Queue only; let our normal drain paths run it when safe
        reflowAgainRef.current = "width";
        reflowQueuedCauseRef.current = `zoom:${why}`;

        if (reflowRunningRef.current || repagRunningRef.current || busyRef.current) {
          void logStep("zoom: queued width reflow (guard busy)");
          return;
        }

        // If we're idle, drain the queue ourselves on the next tick
        window.setTimeout(() => {
          if (
            reflowAgainRef.current === "width" &&
            !reflowRunningRef.current &&
            !repagRunningRef.current &&
            !busyRef.current
          ) {
            reflowAgainRef.current = "none";
            reflowFnRef.current();
          }
        }, 0);
      }, 220);
    };

    const onVV = () => {
      const s = vv?.scale ?? 1;
      if (Math.abs(s - lastScale) > 0.003) {
        lastScale = s;
        schedule("vv-scale");
      }
    };

    const dprPoll = () => {
      const d = window.devicePixelRatio || 1;
      if (Math.abs(d - lastDpr) > 0.003) {
        lastDpr = d;
        schedule("dpr");
      }
    };

    vv?.addEventListener("resize", onVV);
    vv?.addEventListener("scroll", onVV);
    const t = window.setInterval(dprPoll, 400);

    return () => {
      vv?.removeEventListener("resize", onVV);
      vv?.removeEventListener("scroll", onVV);
      window.clearInterval(t);
      if (kick !== null) { window.clearTimeout(kick); }
    };
  }, [computeZoomFactor]);


  /** Init OSMD */
  useEffect(function initOSMDEffect() {
    (async () => {
      const host = hostRef.current;
      const outer = wrapRef.current;
      if (!host || !outer) { return; }

      // Match reflowOnWidthChange: capture, set our func-tag + phase, log start.
      const prevFuncTag = outer.dataset.osmdFunc ?? "";
      outer.dataset.osmdFunc = "initOSMD";
      outer.dataset.osmdPhase = "prep";
      await logStep("phase starting", { outer });

      try {
        const epoch = ++initEpochRef.current;
        outer.dataset.osmdInitEpoch = String(epoch);

        // If a newer init started (src changed), abort this one quietly.
        const isStale = () => outer.dataset.osmdInitEpoch !== String(epoch);

        try {
          const hasVV =
            typeof window !== "undefined" &&
            !!window.visualViewport &&
            typeof window.visualViewport.scale === "number";

          const hasRO =
            typeof window !== "undefined" &&
            "ResizeObserver" in window &&
            typeof window.ResizeObserver === "function";

          outer.dataset.osmdCapVv = hasVV ? "1" : "0";
          outer.dataset.osmdCapRo = hasRO ? "1" : "0";

          await logStep(`hasVV: ${hasVV ? "yes" : "no"} hasRO: ${hasRO ? "yes" : "no"}`, { outer });

          if (!hasVV) {
            // Hard-fail policy
            outer.dataset.osmdPhase = "fatal:no-visual-viewport";
            outer.dataset.osmdFatal = "1";
            setBusyMsg("This viewer requires the Visual Viewport API for correct zoom & pagination.\nTry a modern browser (Chrome, Edge, Safari 16+).");
            setBusy(true); // show blocking overlay with the message
            await logStep("fatal: visualViewport unavailable — aborting init", { outer });
            return; // stop init right here
          }
          if (isStale()) { return; }

        } catch { }

        // --- Dynamic import OSMD ---
        const mod = await perfBlockAsync(
          nextPerfUID(outer.dataset.osmdRun),
          async () => await import("opensheetmusicdisplay"),
          (ms) => { void logStep(`import("opensheetmusicdisplay") runtime: (${ms}ms)`); }
        );
        const { OpenSheetMusicDisplay: OSMDClass } =
          mod as typeof import("opensheetmusicdisplay");

        // Fresh instance
        if (osmdRef.current) {
          osmdRef.current?.clear();
          (osmdRef.current as { dispose?: () => void } | null)?.dispose?.();
          osmdRef.current = null;
        }
        const osmd = new OSMDClass(host, {
          backend: "svg" as const,
          autoResize: false,
          drawTitle: true,
          drawSubtitle: true,
          drawComposer: true,
          drawLyricist: true,
          // Dev aid: render numbers each measure if requested to verify continuity
          drawMeasureNumbers: true,
          measureNumberInterval: debugShowAllMeasureNumbers ? 1 : undefined,
        }) as OpenSheetMusicDisplay;
        osmdRef.current = osmd;

        await spinBegin(outer, { message: DEFAULT_BUSY, gatePaint: true });

        await logStep("phase finished", { outer });
        outer.dataset.osmdPhase = "load";
        await logStep("phase starting", { outer });

        let loadInput: string | Document | ArrayBuffer | Uint8Array = src;

        if (src.startsWith("/api/")) {
          const ab = await perfBlockAsync(
            nextPerfUID(outer.dataset.osmdRun),
            async () => {
              const res = await fetch(src, { cache: "no-store" });
              if (!res.ok) { throw new Error(`HTTP ${res.status}`); }

              const buf = await withTimeout(res.arrayBuffer(), 12000, "fetch timeout");
              outer.dataset.osmdZipBytes = String(buf.byteLength);
              return buf;
            },
            (ms) => {
              const bytes = outer.dataset.osmdZipBytes ?? "?";
              void logStep(`fetch() + arrayBuffer() runtime: (${ms}ms) bytes:${bytes}`);
            }
          );

          const uzMod = await perfBlockAsync(
            nextPerfUID(outer.dataset.osmdRun),
            async () => await withTimeout(import("unzipit"), 4000, "unzipit timeout"),
            (ms) => { void logStep(`import("unzipit") runtime: (${ms}ms)`); }
          );
          const { unzip } = uzMod as typeof import("unzipit");

          const { entries } = await perfBlockAsync(
            nextPerfUID(outer.dataset.osmdRun),
            async () => await withTimeout(unzip(ab), 8000, "unzip timeout"),
            (ms) => { void logStep(`unzip() runtime: (${ms}ms)`); }
          );

          /*          
                    let entryName: string | undefined;
                    const container = entries["META-INF/container.xml"];
                    if (container) {
                      const containerXml = await perfBlockAsync(
                        nextPerfUID(outer.dataset.osmdRun),
                        async () => {
                          const s = await withTimeout(container.text(), 6000, "container.text timeout");
                          outer.dataset.osmdContainerChars = String(s.length);
                          return s;
                        },
                        (ms) => {
                          const chars = outer.dataset.osmdContainerChars ?? "?";
                          void logStep(`container.text() runtime: (${ms}ms) chars:${chars}`);
                        }
                      );
          
                      const cdoc = perfBlock(
                        nextPerfUID(outer.dataset.osmdRun),
                        () => new DOMParser().parseFromString(containerXml, "application/xml"),
                        (ms) => { void logStep(`DOMParser().parseFromString() runtime: (${ms}ms)`); }
                      );
          
                      const rootfile =
                        cdoc.querySelector('rootfile[full-path]') || cdoc.querySelector("rootfile");
                      const fullPath =
                        rootfile?.getAttribute("full-path") ||
                        rootfile?.getAttribute("path") ||
                        rootfile?.getAttribute("href") ||
                        undefined;
          
                      if (fullPath && entries[fullPath]) {
                        entryName = fullPath;
                        await logStep(`container selected: ${entryName}`);
                      } else {
                        await logStep("container not found");
                      }
                    } else {
                      await logStep("container missing");
                    }
          
                    // 5) Fallback scan if container.xml didn’t resolve a score
                    if (!entryName) {
                      const candidates = Object.keys(entries).filter((p) => {
                        const q = p.toLowerCase();
                        return !q.startsWith("meta-inf/") && (q.endsWith(".musicxml") || q.endsWith(".xml"));
                      });
                      void logStep(`candidates length${candidates.length}`);
          
                      candidates.sort((a, b) => {
                        const aa = a.toLowerCase(), bb = b.toLowerCase();
                        const scoreA = /score|partwise|timewise/.test(aa) ? 0 : 1;
                        const scoreB = /score|partwise|timewise/.test(bb) ? 0 : 1;
                        if (scoreA !== scoreB) { return scoreA - scoreB; }
                        const extA = aa.endsWith(".musicxml") ? 0 : 1;
                        const extB = bb.endsWith(".musicxml") ? 0 : 1;
                        if (extA !== extB) { return extA - extB; }
                        return aa.length - bb.length;
                      });
          
                      entryName = candidates[0];
                      await logStep(`entry name ${entryName ?? "(none)"}`);
                    }
          
                    if (!entryName) { throw new Error("entry name missing"); }
          
                    // 6) Read chosen file (timed)
                    const entry = entries[entryName];
                    if (!entry) { throw new Error(`entry missing:${entryName}`); }
          
                    const xmlText = await perfBlockAsync(
                      nextPerfUID(outer.dataset.osmdRun),
                      async () => await withTimeout(entry.text(), 10000, "entry.text() timeout"),
                      (ms) => { void logStep(`entry.text() runtime: (${ms}ms)`); }
                    );
                    outer.dataset.osmdZipChosen = entryName;
                    outer.dataset.osmdZipChars = String(xmlText.length);
          
                    // 7) Parse XML (timed) + validate
                    const xmlDoc = await perfBlockAsync(
                      nextPerfUID(outer.dataset.osmdRun),
                      async () => new DOMParser().parseFromString(xmlText, "application/xml"),
                      (ms) => { void logStep(`DOMParser().parseFromString runtime: (${ms}ms)`); }
                    );
          
                    if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
                      throw new Error("xmlDoc.getElementsByTagName parsererror");
                    }
                    const hasPartwise = xmlDoc.getElementsByTagName("score-partwise").length > 0;
                    const hasTimewise = xmlDoc.getElementsByTagName("score-timewise").length > 0;
                    await logStep(`xmlDoc.getElementsByTagName() hasPartwise: ${String(hasPartwise)} hasTimewise: ${String(hasTimewise)}`);
                    if (!hasPartwise && !hasTimewise) {
                      throw new Error("xmlDoc.getElementsByTagName() no partwise or timewise");
                    }
          
                    {
                      let s = "";
                      s = perfBlock(
                        nextPerfUID(outer.dataset.osmdRun),
                        () => new XMLSerializer().serializeToString(xmlDoc),
                        (ms) => { void logStep(`XMLSerializer().serializeToString runtime: (${ms}ms) chars=${s.length}`); }
                      );
                      outer.dataset.osmdXmlChars = String(s.length);
                      loadInput = s;
                    }
          */

          // --- STRICT MXL container handling (no fallback scan) ---
          // Optional: tag a sub-phase; drop this line if you prefer to keep "load"
          outer.dataset.osmdPhase = "mxl:container";

          // 4) container.xml (required)
          const container = entries["META-INF/container.xml"];
          if (!container) {
            await logStep("container.xml missing → abort");
            throw new Error("MXL error: META-INF/container.xml missing");
          }

          // 5) Read + parse container.xml
          const containerXml = await perfBlockAsync(
            nextPerfUID(outer.dataset.osmdRun),
            async () => {
              const s = await withTimeout(container.text(), 6000, "container.text timeout");
              outer.dataset.osmdContainerChars = String(s.length);
              return s;
            },
            (ms) => {
              const chars = outer.dataset.osmdContainerChars ?? "?";
              void logStep(`container.text() runtime: (${ms}ms) chars:${chars}`);
            }
          );

          const cdoc = perfBlock(
            nextPerfUID(outer.dataset.osmdRun),
            () => new DOMParser().parseFromString(containerXml, "application/xml"),
            (ms) => { void logStep(`DOMParser().parseFromString() runtime: (${ms}ms)`); }
          );

          // 6) Resolve rootfile path (full-path|path|href)
          const rootEl =
            cdoc.querySelector('rootfile[full-path]') ||
            cdoc.querySelector('rootfile[path]') ||
            cdoc.querySelector('rootfile[href]');

          const fullPath =
            rootEl?.getAttribute("full-path") ||
            rootEl?.getAttribute("path") ||
            rootEl?.getAttribute("href") ||
            "";

          if (!fullPath) {
            await logStep("container rootfile path missing → abort");
            throw new Error("MXL error: container.xml lacks a rootfile path");
          }

          if (!entries[fullPath]) {
            await logStep(`container rootfile not in ZIP (${fullPath}) → abort`);
            throw new Error(`MXL error: rootfile entry not found in archive: ${fullPath}`);
          }

          await logStep(`container selected: ${fullPath}`);

          // 7) Read chosen MusicXML (timed)
          const entry = entries[fullPath]!;
          const xmlText = await perfBlockAsync(
            nextPerfUID(outer.dataset.osmdRun),
            async () => await withTimeout(entry.text(), 10000, "entry.text() timeout"),
            (ms) => { void logStep(`entry.text() runtime: (${ms}ms)`); }
          );
          outer.dataset.osmdZipChosen = fullPath;
          outer.dataset.osmdZipChars = String(xmlText.length);

          // 8) Parse XML (timed) + validate
          const xmlDoc = await perfBlockAsync(
            nextPerfUID(outer.dataset.osmdRun),
            async () => new DOMParser().parseFromString(xmlText, "application/xml"),
            (ms) => { void logStep(`DOMParser().parseFromString runtime: (${ms}ms)`); }
          );

          if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
            throw new Error("xmlDoc.getElementsByTagName parsererror");
          }
          const hasPartwise = xmlDoc.getElementsByTagName("score-partwise").length > 0;
          const hasTimewise = xmlDoc.getElementsByTagName("score-timewise").length > 0;
          await logStep(
            `xmlDoc.getElementsByTagName() hasPartwise: ${String(hasPartwise)} hasTimewise: ${String(hasTimewise)}`
          );
          if (!hasPartwise && !hasTimewise) {
            throw new Error("xmlDoc.getElementsByTagName() no partwise or timewise");
          }

          // 9) Serialize and hand off to OSMD.load(...)
          {
            let s = "";
            s = perfBlock(
              nextPerfUID(outer.dataset.osmdRun),
              () => new XMLSerializer().serializeToString(xmlDoc),
              (ms) => { void logStep(`XMLSerializer().serializeToString runtime: (${ms}ms) chars=${s.length}`); }
            );
            outer.dataset.osmdXmlChars = String(s.length);
            loadInput = s;
          }


        } else {
          // Non-API source: use as-is
          loadInput = src;
        }

        await perfBlockAsync(
          nextPerfUID(outer.dataset.osmdRun),
          async () => {
            await awaitLoad(osmd, loadInput);
          },
          (ms) => {
            void logStep(`awaitLoad() runtime: (${ms}ms)`, { outer });
          }
        );

        await perfBlockAsync(
          nextPerfUID(outer.dataset.osmdRun),
          async () => { await waitForFonts(); },
          (ms) => { void logStep(`waitForFonts() runtime: (${ms}ms)`); }
        );

        await logStep("phase finished", { outer });

        const { bands, starts } = await renderScanApply(outer, osmd, {
          gateLabel: "apply:first",
          gateMs: 450,
          doubleApply: false, // // init: single apply; we’ll repaginate on height next
        });
        outer.dataset.osmdBands = String(bands.length);
        outer.dataset.osmdPages = String(starts.length);

        // Immediately recompute page starts using the *final* visible height.
        // Why: on first load, the browser/UI chrome (URL/tool bars) can settle a frame
        // or two later. This cheap pass does height-only pagination (no OSMD render),
        // resets to page 1, and ensures we’re not showing a split system at the bottom.
        recomputePaginationHeightOnly();

        // Record the dimensions we just handled. The VisualViewport listener compares
        // future vv events against these to decide:
        //   - width changed -> full reflow (renderScanApply via reflowOnWidthChange)
        //   - height only   -> quick repagination
        // We capture them here once at the end of init; the width-reflow path updates
        // these itself at the start of each run.
        handledWRef.current = outer.clientWidth;
        handledHRef.current = outer.clientHeight;

        // Mark the viewer as “ready” so zoom/DPR listeners become active.
        // This is a one-time toggle per init and is never set in the reflow path.
        readyRef.current = true;

        // First page is applied and masking is in place — hide the overlay now.
        // In the reflow path the spinner is ended in its `finally` block.
        // because a fatal no-VV path sets busy directly and must keep the overlay visible.
        await spinEnd(outer);

        await logStep("init:ready", { outer }); // optional breadcrumb

      } finally {
        try { outer.dataset.osmdPhase = "finally"; } catch { }
        await logStep("phase starting", { outer });

        await logStep("phase finished", { outer });

        // Restore previous func-tag (exactly like reflowOnWidthChange).
        try { outer.dataset.osmdFunc = prevFuncTag; } catch { }
      }

    })().catch(async (err: unknown) => {
      // If init crashed after spinBegin, close the spinner immediately.
      // (Fatal no-visualViewport path never sets spinnerOwnerRef, so it stays up.)
      if (spinnerOwnerRef.current) {
        try { await spinEnd(wrapRef.current!); } catch { }
      } else {
        hideBusy(); // fallback for any older/non-spinner busy state
      }

      const outerNow = wrapRef.current;
      const msg = err instanceof Error ? err.message :
        typeof err === "string" ? err :
          JSON.stringify(err);

      if (outerNow) {
        outerNow.setAttribute("data-osmd-step", "init-crash");
        outerNow.dataset.osmdErr = String(msg).slice(0, 180);
        void logStep(`init:crash:${outerNow.dataset.osmdErr}`);
      }
    });

    return () => {
      try {
        if (initFinalizeTimerRef.current) {
          window.clearTimeout(initFinalizeTimerRef.current);
          initFinalizeTimerRef.current = null;
        }
      } catch { }

      if (osmdRef.current) {
        osmdRef.current?.clear();
        (osmdRef.current as { dispose?: () => void } | null)?.dispose?.();
        osmdRef.current = null;
      }
    };
    // Only re-init when source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, debugShowAllMeasureNumbers]);


  /** Paging helpers */
  // --- Stuck-page guard: ensure forward/back actually lands on the next/prev start ---
  const tryAdvance = useCallback(
    (dir: 1 | -1) => {
      if (busyRef.current) { return; }

      const starts = pageStartsRef.current;
      const pages = starts.length;
      if (!pages) { return; }

      const beforePage = pageIdxRef.current;
      const targetPage = Math.max(0, Math.min(beforePage + dir, pages - 1));
      if (targetPage === beforePage) { return; }

      // The start index we want to land on after any recompute
      const desiredStart = starts[targetPage] ?? starts[beforePage] ?? 0;

      applyPage(targetPage);

      // If we didn't actually move, rebuild page starts and retry *toward* desiredStart.
      window.requestAnimationFrame(() => {
        if (pageIdxRef.current !== beforePage) { return; } // we moved – all good

        const outer = wrapRef.current;
        if (!outer) { return; }

        const fresh = computePageStartIndices(outer, bandsRef.current, getPAGE_H(outer));
        if (!fresh.length) { return; }

        pageStartsRef.current = fresh;

        // pick first start >= desiredStart (forward) or last start <= desiredStart (backward)
        let idx: number;
        if (dir === 1) {
          idx = fresh.findIndex((s) => s >= desiredStart);
          if (idx < 0) { idx = fresh.length - 1; }
        } else {
          let firstGreater = fresh.findIndex((s) => s > desiredStart);
          if (firstGreater < 0) { firstGreater = fresh.length; }
          idx = Math.max(0, firstGreater - 1);
        }

        if (idx !== beforePage) { applyPage(idx); }
      });
    },
    [applyPage, getPAGE_H]
  );

  const goNext = useCallback(() => tryAdvance(1), [tryAdvance]);
  const goPrev = useCallback(() => tryAdvance(-1), [tryAdvance]);

  // Wheel & keyboard paging (disabled while busy)
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!readyRef.current || busyRef.current) {
        return;
      }
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) {
        return;
      }
      e.preventDefault();
      if (e.deltaY > 0) {
        goNext();
      } else {
        goPrev();
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (!readyRef.current || busyRef.current) {
        return;
      }
      if (["PageDown", "ArrowDown", " "].includes(e.key)) {
        e.preventDefault();
        goNext();
      } else if (["PageUp", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        goPrev();
      } else if (e.key === "Home") {
        e.preventDefault();
        applyPage(0);
      } else if (e.key === "End") {
        e.preventDefault();
        const last = Math.max(0, pageStartsRef.current.length - 1);
        applyPage(last);
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [applyPage, goNext, goPrev]);

  // Touch swipe paging (disabled while busy)
  useEffect(() => {
    const outer = wrapRef.current;
    if (!outer) { return; }

    let startY = 0;
    let startX = 0;
    let startT = 0; // ← add
    let active = false;

    // Tunables for what counts as a "tap"
    const TAP_MAX_MS = 250;       // quick touch
    const TAP_MAX_MOVE_PX = 12;   // little to no movement

    const onTouchStart = (e: TouchEvent) => {
      if (!readyRef.current || busyRef.current || e.touches.length === 0) {
        return;
      }
      active = true;
      startY = e.touches[0]?.clientY ?? 0;
      startX = e.touches[0]?.clientX ?? 0;
      startT = performance.now();          // ← add
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!active || !readyRef.current || busyRef.current) {
        return;
      }
      e.preventDefault();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!active) {
        return;
      }
      active = false;
      if (busyRef.current) {
        return;
      }
      const t = e.changedTouches[0];
      if (!t) { return; }

      const dy = t.clientY - startY;
      const dx = t.clientX - startX;
      const dt = performance.now() - startT;  // ← add

      // 1) Tap-to-advance (quick + tiny movement)
      if (Math.abs(dx) <= TAP_MAX_MOVE_PX && Math.abs(dy) <= TAP_MAX_MOVE_PX && dt <= TAP_MAX_MS) {
        goNext();
        return;
      }

      // 2) Your existing swipe logic
      const THRESH = 40;
      const H_RATIO = 0.6;
      if (Math.abs(dy) >= THRESH && Math.abs(dx) <= Math.abs(dy) * H_RATIO) {
        if (dy < 0) {
          goNext();
        } else {
          goPrev();
        }
      }
    };

    outer.addEventListener("touchstart", onTouchStart, { passive: true });
    outer.addEventListener("touchmove", onTouchMove, { passive: false });
    outer.addEventListener("touchend", onTouchEnd, { passive: true });

    outer.style.overscrollBehavior = "contain";

    const cleanupOuter = outer;
    return () => {
      cleanupOuter.removeEventListener("touchstart", onTouchStart);
      cleanupOuter.removeEventListener("touchmove", onTouchMove);
      cleanupOuter.removeEventListener("touchend", onTouchEnd);
    };
  }, [goNext, goPrev]);

  // Recompute pagination when the visual viewport changes (URL bar, IME, orientation, etc.)
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    if (!vv) { return; }

    const onVisualViewportChange = () => {
      if (!readyRef.current) { return; }

      // debounce vv events
      if (vvTimerRef.current) { window.clearTimeout(vvTimerRef.current); }
      vvTimerRef.current = window.setTimeout(async () => {
        vvTimerRef.current = null;

        const outerNow = wrapRef.current;
        if (!outerNow) { return; }

        // Tag logs with function name; clear phase since this isn't a render/scan/apply phase
        const prevFuncTag = outerNow.dataset.osmdFunc ?? "";
        const prevPhase = outerNow.dataset.osmdPhase ?? "";
        outerNow.dataset.osmdFunc = "onVisualViewportChange";
        outerNow.dataset.osmdPhase = "";

        try {
          // Current wrapper (host) size in CSS px
          const wrapW = outerNow.clientWidth;
          const wrapH = outerNow.clientHeight;

          // Current VisualViewport metrics (for diagnosis only)
          const vvW = Math.floor(vv?.width ?? 0);
          const vvH = Math.floor(vv?.height ?? 0);
          const vvScale = (vv?.scale ?? (window.devicePixelRatio || 1));

          // What we last handled (used to decide if work is needed)
          const handledWrapW = handledWRef.current;
          const handledWrapH = handledHRef.current;

          const widthChanged =
            handledWrapW === -1 || Math.abs(wrapW - handledWrapW) >= 1;
          const heightChanged =
            handledWrapH === -1 || Math.abs(wrapH - handledWrapH) >= 1;

          // Only log when we're going to act; keeps noise down long-term.
          if (widthChanged || heightChanged) {
            await logStep(
              `wrap=${wrapW}×${wrapH} vv=${vvW}×${vvH} scale=${vvScale.toFixed(3)} ` +
              `handled=${handledWrapW}×${handledWrapH} ΔW=${widthChanged} ΔH=${heightChanged}`,
              { outer: outerNow }
            );
          } else {
            return; // nothing to do
          }

          // Guard against heavy work overlapping
          const kind = widthChanged ? "width" : "height";
          if (busyRef.current) {
            reflowAgainRef.current = kind;
            reflowQueuedCauseRef.current = `vv:guard-busy:${kind}`;
            return;
          }
          if (reflowRunningRef.current) {
            reflowAgainRef.current = kind;
            reflowQueuedCauseRef.current = `vv:guard-reflow:${kind}`;
            return;
          }
          if (repagRunningRef.current) {
            reflowAgainRef.current = kind;
            reflowQueuedCauseRef.current = `vv:guard-repag:${kind}`;
            return;
          }

          // Do the work
          if (widthChanged) {
            // Horizontal change → full OSMD reflow + reset to page 1
            await reflowFnRef.current();
            handledWRef.current = wrapW;
            handledHRef.current = wrapH;
          } else {
            // Vertical-only change → cheap repagination (no spinner) + reset to page 1
            repagFnRef.current();
            handledHRef.current = wrapH;
          }
        } finally {
          // Restore previous tags so later logs show the right context
          outerNow.dataset.osmdFunc = prevFuncTag;
          outerNow.dataset.osmdPhase = prevPhase;
        }
      }, 200);
    };

    vv.addEventListener("resize", onVisualViewportChange);
    vv.addEventListener("scroll", onVisualViewportChange);
    return () => {
      vv.removeEventListener("resize", onVisualViewportChange);
      vv.removeEventListener("scroll", onVisualViewportChange);
      if (vvTimerRef.current) {
        window.clearTimeout(vvTimerRef.current);
        vvTimerRef.current = null;
      }
    };
  }, []);

  // Auto-clear busy if we linger too long *outside* heavy phases.
  // Heavy phases are exactly: "render" and "scan".
  useEffect(() => {
    if (!busy) { return; }

    const t = window.setTimeout(() => {
      const phase = wrapRef.current?.dataset.osmdPhase ?? "";
      const inHeavy = phase === "render" || phase === "scan";

      if (!inHeavy) {
        hideBusy();
        void logStep("busy:auto-clear");
      } else {
        void logStep(`busy:auto-clear:skipped phase=${phase}`);
      }
    }, 20000);

    return () => window.clearTimeout(t);
  }, [busy, hideBusy]);

  // POST-BUSY QUEUE DRAIN: if width/height work was queued while busy, run it now.
  // These kick off heavy paths; add a tiny breadcrumb, but don't await paint here.
  useEffect(() => {
    if (busy) { return; } // only act when the overlay turned off
    const queued = reflowAgainRef.current;
    reflowAgainRef.current = "none";

    if (queued === "width") {
      const cause = reflowQueuedCauseRef.current || "drain:post-busy";
      reflowQueuedCauseRef.current = "";
      window.setTimeout(() => {
        void logStep(`queue:drain:width cause=${cause}`);
        reflowFnRef.current();
      }, 0);
    } else if (queued === "height") {
      window.setTimeout(() => {
        void logStep("queue:drain:height");
        repagFnRef.current();
      }, 0);
    }
  }, [busy]);


  /* ---------- Styles ---------- */

  const isFill = fillParent;
  const outerStyle: React.CSSProperties = isFill
    ? {
      width: "100%",
      height: vpHRef.current > 0 ? vpHRef.current : "100vh", // ← was "100%"
      minHeight: 320,                                        // ← was 0
      position: "relative",
      overflow: "hidden",
      background: "#fff",
      paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2px)",
      boxSizing: "border-box",
      isolation: "isolate",
    }
    : {
      width: "100%",
      height: height ?? 600,
      minHeight: height ?? 600,
      position: "relative",
      overflow: "hidden",
      background: "#fff",
      paddingBottom: "2px",
      boxSizing: "border-box",
      isolation: "isolate",
    };

  const hostStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    minWidth: 0,
  };

  /* ---------- Busy overlay ---------- */
  const blockerStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    display: busy ? "grid" : "none",
    placeItems: "center",
    background: "rgba(0,0,0,0.45)",
    backdropFilter: "blur(2px)",
    cursor: "wait",
  };

  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={wrapRef}
      data-osmd-wrapper="1"
      data-osmd-probe="v10"
      className={className}
      style={{ /* outline: "4px solid fuchsia", */ ...outerStyle, ...style }}
    >
      {/* OSMD host (SVG goes here) */}
      <div ref={hostRef} style={hostStyle} />

      {/* Input-blocking overlay while busy */}
      <div
        ref={overlayRef}
        aria-busy={busy}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={blockerStyle}
        onPointerDown={stop}
        onPointerMove={stop}
        onPointerUp={stop}
        onTouchStart={stop}
        onTouchMove={stop}
        onWheel={stop}
        onScroll={stop}
        onMouseDown={stop}
        onContextMenu={stop}
      >
        <div
          style={{
            background: "rgba(255,255,255,0.92)",
            borderRadius: 12,
            padding: "10px 14px",
            boxShadow: "0 6px 20px rgba(0,0,0,0.2)",
            fontSize: 14,
            color: "#111",
            textAlign: "center",
            minWidth: 140,
          }}
        >
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              border: "2px solid rgba(0,0,0,0.4)",
              borderTopColor: "transparent",
              margin: "0 auto 8px",
              animation: "osmd-spin 0.9s linear infinite",
            }}
          />
          <div>{busyMsg || DEFAULT_BUSY}</div>
        </div>
      </div>

      <style>{`@keyframes osmd-spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
