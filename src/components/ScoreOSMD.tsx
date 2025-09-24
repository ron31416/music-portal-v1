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

/* ---------- Reflow & pagination sizing (central knobs) ---------- */
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
};

async function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => window.setTimeout(() => rej(new Error(tag)), ms)),
  ]);
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

      function finish(why: "raf" | "timeout" | "hidden" | "message" | "safety-tick" | "ceiling"): void {
        if (done) { return; }
        done = true;
        try {
          outer.dataset.osmdAfterpaint = `${label ?? ""}:${why}`;
          const now =
            typeof performance !== "undefined" && typeof performance.now === "function"
              ? performance.now()
              : Date.now();
          const ms = Math.round(now - t0);
          outer.dataset.osmdAfterpaintMs = String(ms);
          const box = document.querySelector<HTMLPreElement>('pre[data-osmd-log="1"]');
          if (box) {
            const ts = new Date().toISOString().split('T')[1]?.split('.')[0] ?? '';
            box.textContent += `[${ts}] [ap] ${label ?? ""} -> ${why} (${ms}ms)\n`;
            box.scrollTop = box.scrollHeight;
          }
        } catch {}
        resolve();
      }

      if (document.visibilityState !== "visible") {
        window.setTimeout(() => finish("hidden"), 0);
        return;
      }

      try {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => finish("raf"));
        });
      } catch {}

      window.setTimeout(() => finish("timeout"), timeoutMs);

      try {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => {
          ch.port1.onmessage = null;
          finish("message");
        };
        ch.port2.postMessage(1);
      } catch {}

      // Never wedge even if rAF/message are throttled: resolve next macrotask.
      window.setTimeout(() => finish("safety-tick"), 0);

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

/** Top-layer root used only for the debug console */
function getTopLayer(): HTMLDivElement {
  let root = document.querySelector<HTMLDivElement>('[data-osmd-toplayer="1"]');
  if (!root) {
    root = document.createElement('div');
    root.dataset.osmdToplayer = '1';
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: String(2147483647),
      pointerEvents: 'none',
      margin: '0',
      padding: '0',
      transform: 'none',
      filter: 'none',
      contain: 'layout style paint',
    } as CSSStyleDeclaration);
    document.body.appendChild(root);

    if (!document.querySelector('style[data-osmd-log-reset]')) {
      const st = document.createElement('style');
      st.setAttribute('data-osmd-log-reset', '');
      st.textContent = `
        html, body { margin:0 !important; padding:0 !important; border:0 !important; }
        html, body, #__next, [data-osmd-root] { transform:none !important; filter:none !important; }
      `;
      document.head.appendChild(st);
    }
  }
  return root;
}

/** The only on-page console: docked left, full height */
function getConsoleTop(): HTMLPreElement {
  const root = getTopLayer();

  let box = root.querySelector<HTMLPreElement>('pre[data-osmd-log="1"]');
  if (!box) {
    box = document.createElement('pre');
    box.dataset.osmdLog = '1';

    Object.assign(box.style, {
      position: 'absolute',
      left: '8px',
      right: 'auto',
      // we’ll drive top/bottom dynamically to fill full height
      top: '0px',
      bottom: '0px',
      width: 'min(560px, 45vw)',           // narrow column; resizeable
      maxWidth: 'calc(100vw - 16px)',
      overflow: 'auto',
      background: 'rgba(0,0,0,0.85)',
      color: '#0f0',
      padding: '6px 8px',
      borderRadius: '8px',
      font: '11px/1.35 monospace',
      whiteSpace: 'pre-wrap',
      pointerEvents: 'auto',               // allow scrolling
      touchAction: 'pan-y',
      overscrollBehavior: 'contain',
      boxSizing: 'border-box',
      resize: 'horizontal',                // drag to widen/narrow
    } as CSSStyleDeclaration);

    root.appendChild(box);

    const syncBounds = () => {
      try {
        const vv = (typeof window !== 'undefined' && 'visualViewport' in window)
          ? window.visualViewport
          : undefined;

        if (vv) {
          const topPx = Math.max(0, Math.floor(vv.offsetTop));
          const bottomGapPx = Math.max(
            0,
            Math.floor((window.innerHeight || 0) - (vv.offsetTop + vv.height))
          );
          // Fill the visible viewport between its top and bottom edges
          box!.style.top    = `calc(${topPx}px + env(safe-area-inset-top, 0px))`;
          box!.style.bottom = `calc(${bottomGapPx}px + env(safe-area-inset-bottom, 0px))`;
        } else {
          // Desktop fallback: simply fill from top to bottom
          box!.style.top = 'env(safe-area-inset-top, 0px)';
          box!.style.bottom = 'env(safe-area-inset-bottom, 0px)';
        }
      } catch {
        box!.style.top = '0px';
        box!.style.bottom = '0px';
      }
    };

    // Keep pinned to the visible viewport
    try {
      window.visualViewport?.addEventListener('resize', syncBounds);
      window.visualViewport?.addEventListener('scroll', syncBounds);
    } catch {}
    window.addEventListener('resize', syncBounds);
    window.addEventListener('scroll', syncBounds, { passive: true });
    window.addEventListener('orientationchange', syncBounds);

    // Initial layout
    syncBounds();
  }
  return box;
}

/** Best-effort "wait until the browser can paint" (bounded) */
async function waitForPaint(timeoutMs = 450): Promise<void> {
  try {
    // macrotask so React commit happens
    await new Promise<void>(r => window.setTimeout(r, 0));
    // double-rAF (or timeout) so the frame has a chance to paint
    if (document.visibilityState === 'visible') {
      await Promise.race([
        new Promise<void>(r => window.requestAnimationFrame(() =>
          window.requestAnimationFrame(() => r())
        )),
        new Promise<void>(r => window.setTimeout(r, timeoutMs)),
      ]);
    }
  } catch {}
}

// Flip this to disable all on-page logging in one place.
const DEBUG_LOG = true;

let __logQueue: Promise<void> = Promise.resolve();

export async function logStep(
  message: string,
  opts: { paint?: boolean; outer?: HTMLDivElement | null } = {}
): Promise<void> {
  if (!DEBUG_LOG) { return; }

  const { paint = false, outer = null } = opts;

  __logQueue = __logQueue.then(async () => {
    const box = getConsoleTop();
    const ts = new Date().toISOString().split("T")[1]?.split(".")[0] ?? "";
    box.textContent += `[${ts}] ${message}\n`;
    box.scrollTop = box.scrollHeight;

    if (outer) {
      outer.dataset.osmdLastLog = `${Date.now()}:${message.slice(0, 80)}`;
    }

    if (paint) {
      await waitForPaint(); // give the browser a chance to actually paint
    }
  }).catch(() => { /* keep the queue alive even if a write fails */ });

  return __logQueue;
}

function tnow() {
  return (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
}

// --- DIAGNOSTIC: tiny timing helper (no behavior change) ---
function timeSection<T>(label: string, fn: () => T): T {
  const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  const out = fn();
  const t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  void logStep(`${label}: ${Math.round(t1 - t0)}ms`);
  return out;
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

/** Cluster OSMD <g> to “systems” and measure them relative to wrapper */
function measureSystemsPx(outer: HTMLDivElement, svgRoot: SVGSVGElement): Band[] {
  const pageRoots = Array.from(
    svgRoot.querySelectorAll<SVGGElement>(
      'g[id^="osmdCanvasPage"], g[id^="Page"], g[class*="Page"], g[class*="page"]'
    )
  );
  const roots: Array<SVGGElement | SVGSVGElement> = pageRoots.length ? pageRoots : [svgRoot];

  const hostTop = outer.getBoundingClientRect().top;
  interface Box { top: number; bottom: number; height: number; width: number }
  const boxes: Box[] = [];

  for (const root of roots) {
    for (const g of Array.from(root.querySelectorAll<SVGGElement>("g"))) {
      const r = g.getBoundingClientRect();
      if (!Number.isFinite(r.top) || !Number.isFinite(r.height) || !Number.isFinite(r.width)) {
        continue;
      }
      // Looser thresholds so very narrow measures on phones are still captured
      const MIN_H = 2;   // was 8 → 4 → 2 (capture ultra-thin groups)
      const MIN_W = 8;   // was 40 → 16 → 8
      if (r.height < MIN_H || r.width < MIN_W) {
        continue;
      }
      boxes.push({
        top: r.top - hostTop,
        bottom: r.bottom - hostTop,
        height: r.height,
        width: r.width,
      });
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
  return bands;
}

/** Compute page start *indices* so each page shows only full systems */
function computePageStartIndices(bands: Band[], viewportH: number): number[] {
  if (bands.length === 0 || viewportH <= 0) {
    return [0];
  }

  const starts: number[] = [];
  let i = 0;
  const fuseTitle = isTitleLike(bands[0], bands.slice(1));

  while (i < bands.length) {
    const current = bands[i];
    if (!current) {
      break;
    }

    const startTop = current.top;
    let last = i;

    while (last + 1 < bands.length) {
      const next = bands[last + 1];
      if (!next) { break; }

      const isFirstPage = starts.length === 0 && i === 0;
      const slack = isFirstPage && fuseTitle
        ? Math.max(12, Math.round(viewportH * 0.06))
        : 0;

      // Optional tweak: on first page, try to fit title + two full systems
      if (isFirstPage) {
        const systemsToTry = 2;        // title + 2 systems
        const endIdx = i + systemsToTry;
        const endBand = bands[endIdx];
        if (endBand && (endBand.bottom - startTop) <= (viewportH + slack)) {
          last = endIdx;
          continue; // keep scanning from the new 'last'
        }
      }

      if (next.bottom - startTop <= viewportH + slack) {
        last++;
      } else {
        break;
      }
    }

    starts.push(i);
    i = last + 1;
  }

  return starts.length ? starts : [0];
}

function hasZoomProp(o: unknown): o is { Zoom: number } {
  if (typeof o !== "object" || o === null) { return false; }
  const maybe = o as { Zoom?: unknown };
  return typeof maybe.Zoom === "number";
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

  // Debounce + reentry guards for resize/viewport changes
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  const resizeTimerRef = useRef<number | null>(null); // ResizeObserver debounce
  const vvTimerRef = useRef<number | null>(null);     // visualViewport debounce

  const handledWRef = useRef<number>(-1);
  const handledHRef = useRef<number>(-1);

  // Record the dimensions we just handled so observers don't re-queue
  const stampHandledDims = (outer: HTMLDivElement) => {
    handledWRef.current = outer.clientWidth;
    handledHRef.current = outer.clientHeight;
    outer.dataset.osmdHandled = `${handledWRef.current}×${handledHRef.current}`;
    void logStep(`handled:set W×H=${handledWRef.current}×${handledHRef.current}`);
  };

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
        try { inst.Zoom = clamped; } catch {}
      }
    }
  }, []);

  const renderWithEffectiveWidth = useCallback(
    async (
      outer: HTMLDivElement,
      osmd: OpenSheetMusicDisplay
    ): Promise<void> => {
      const host = hostRef.current;
      if (!host || !outer) { return; }

      // Use our zoom source of truth
      applyZoomFromRef();
      const zf = Math.min(3, Math.max(0.5, zoomFactorRef.current || 1));

      const hostW = Math.max(1, Math.floor(outer.clientWidth));
      const rawLayoutW = Math.max(1, Math.floor(hostW / zf));
      const layoutW = Math.max(
        REFLOW.MIN_LAYOUT_W,
        Math.min(rawLayoutW + REFLOW.WIDTH_NUDGE, REFLOW.MAX_LAYOUT_W)
      );

      outer.dataset.osmdZf = String(zf);
      outer.dataset.osmdLayoutW = String(layoutW);

      // --- START: render heartbeat + strong containment/offscreen render ---
      const startedAt =
        (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();

      const beat = window.setInterval(() => {
        const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        const secs = Math.round((now - startedAt) / 1000);
        void logStep(`render:heartbeat +${secs}s`);
      }, 1000);

      // Snapshot styles we’re going to touch
      const prev = {
        position: host.style.position,
        left: host.style.left,
        right: host.style.right,
        top: host.style.top,
        bottom: host.style.bottom, 
        width: host.style.width,
        visibility: host.style.visibility,
        pointerEvents: host.style.pointerEvents,
        contain: host.style.contain,
      };

      try {
        // Render the giant SVG **offscreen** with strong containment so the
        // browser doesn’t try to paint it in-viewport before we paginate.
        host.style.position = "fixed";
        host.style.top = "-100000px";
        host.style.left = "-100000px";
        host.style.right = "auto";
        host.style.bottom = "auto";
        host.style.visibility = "hidden";
        host.style.pointerEvents = "none";
        host.style.contain = "layout style paint"; // strong containment
        host.style.width = `${layoutW}px`;

        // Ensure styles take effect this task
        void host.getBoundingClientRect();

        await logStep(
          `render:call w=${layoutW} hostW=${hostW} zf=${zf.toFixed(3)} osmd.Zoom=${osmd.Zoom ?? "n/a"}`
        );

        osmd.render(); // synchronous & heavy

        // Give the browser one macrotask tick to breathe before we return.
        // (If layout wants to flush, this lets timers/rAF queue up.)
        await new Promise<void>((r) => window.setTimeout(r, 0));
      } catch (e) {
        void logStep(`render:error ${(e as Error)?.message ?? e}`);
        throw e;
      } finally {
        try { window.clearInterval(beat); } catch {}
        // Always restore styles even if another render started
        host.style.position      = prev.position;
        host.style.top           = prev.top;
        host.style.left          = prev.left;
        host.style.right         = prev.right;
        host.style.bottom        = prev.bottom;
        host.style.width         = prev.width;
        host.style.visibility    = prev.visibility;
        host.style.pointerEvents = prev.pointerEvents;
        host.style.contain       = prev.contain;

        const svg = getSvg(outer);
        if (svg) { svg.style.transformOrigin = "top left"; }
      }
      // --- END ---
    },
    [applyZoomFromRef]
  );

  const hideBusy = useCallback(async () => {
    setBusy(false);
    setBusyMsg(DEFAULT_BUSY);
    await logStep("busy:off"); // or { paint: true } if you want it blocking
  }, []);

  // --- LOG SNAPSHOT (used by zoom/reflow debug logs) ---
  const fmtFlags = useCallback((): string => {
    const w = wrapRef.current?.clientWidth ?? -1;
    const h = wrapRef.current?.clientHeight ?? -1;
    const pages = pageStartsRef.current.length;
    const page  = Math.max(0, Math.min(pageIdxRef.current, Math.max(0, pages - 1)));
    const phase = wrapRef.current?.dataset.osmdPhase ?? "(none)";
    return [
      `ready=${String(readyRef.current)}`,
      `busy=${String(busyRef.current)}`,
      `reflowRunning=${String(reflowRunningRef.current)}`,
      `repagRunning=${String(repagRunningRef.current)}`,
      `queued=${reflowAgainRef.current}`,
      `osmd=${String(!!osmdRef.current)}`,
      `zf=${(zoomFactorRef.current ?? 0).toFixed(3)}`,
      `W×H=${w}×${h}`,
      `page=${page+1}/${Math.max(1, pages)}`,
      `phase=${phase}`,
    ].join(" ");
  }, []);

  // ---- callback ref proxies (used by queued window.setTimeouts) ----
  const reflowFnRef = useRef<
    (resetToFirst?: boolean, reflowCause?: string) => void | Promise<void>
  >(() => {});
  
  const repagFnRef = useRef<
    (resetToFirst?: boolean, showBusy?: boolean) => void
  >(() => {});

  const vpHRef = useVisibleViewportHeight();

  const getViewportH = useCallback((outer: HTMLDivElement): number => {
    const v = vpHRef.current || 0;                              // visualViewport
    const outerH = outer.clientHeight || 0;                     // wrapper height
    const docH = Math.floor(document.documentElement?.clientHeight || 0); // fallback

    // Prefer wrapper height; fall back to visualViewport; then to document
    const base = outerH > 0 ? outerH : (v > 0 ? v : docH);

    // Always return a positive, integer px height minus the gutter
    return Math.max(1, Math.floor(base) - Math.max(0, topGutterPx));
  }, [vpHRef, topGutterPx]);

  const bottomPeekPad = useCallback(
    () => ((window.devicePixelRatio || 1) >= 2 ? 6 : 5), // same pad everywhere
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

  // ---- On-demand debug dump (no keyboard needed)
  const dumpDebug = useCallback((): void => {
    const outer = wrapRef.current;
    if (!outer) { return; }

    const zf = zoomFactorRef.current ?? 1;
    const layoutW = Number(outer.dataset.osmdLayoutW || NaN);
    const w = outer.clientWidth || 0;
    const h = outer.clientHeight || 0;
    const phase = outer.dataset.osmdPhase || "(none)";
    const busyNow = busyRef.current;

    void logStep(
      `debug:data zf=${zf.toFixed(3)} layoutW=${Number.isNaN(layoutW) ? "?" : layoutW} W×H=${w}×${h} busy=${busyNow} phase=${phase}`
    );

    const measured = withUntransformedSvg(outer, (svg) => measureSystemsPx(outer, svg)) ?? [];
    const H = getPAGE_H(outer);
    const starts = computePageStartIndices(measured, H);

    void logStep(
      `debug:probe measured bands=${measured.length} H=${H} starts=${starts.join(",") || "(none)"}`
    );
  }, [getPAGE_H]);

  /** Apply a page index */
  const applyPage = useCallback(
    (pageIdx: number, depth: number = 0): void => {
      if (depth > 3) {           // hard stop if anything oscillates
        const outerNow = wrapRef.current;
        if (outerNow) {
          outerNow.dataset.osmdPhase = 'applyPage:bailout';
          logStep('applyPage:bailout depth>3'); // single logger
        }
        return;
      }
      const outer = wrapRef.current;
      if (!outer) {
        return;
      }

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
            const fresh = computePageStartIndices(bands, PAGE_H);
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
        const freshStarts = computePageStartIndices(bands, PAGE_H); // ← PAGE_H
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

        const relBottom  = lastBand.bottom - startBand.top;
        const nextTopRel = nextBand.top    - startBand.top;

        // If nothing from the next page peeks into the viewport, don't mask at all.
        if (nextTopRel >= hVisible - PEEK_GUARD - 1) { return hVisible; }

        // Otherwise, hide just the peeking sliver.
        const nudge = (window.devicePixelRatio || 1) >= 2 ? 3 : 2;
        const low  = Math.ceil(relBottom) + MASK_BOTTOM_SAFETY_PX - nudge;
        const high = Math.floor(nextTopRel) - PEEK_GUARD;

        if (low > high) {
          const fresh = computePageStartIndices(bands, PAGE_H);
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

      // Breadcrumbs (data attrs kept; HUD removed)
      outer.dataset.osmdLastApply = String(Date.now());
      outer.dataset.osmdPage = String(pageIdxRef.current);
      outer.dataset.osmdMaskTop = String(maskTopWithinMusicPx);
      outer.dataset.osmdPages  = String(pages);
      outer.dataset.osmdStarts = starts.slice(0, 12).join(',');
      outer.dataset.osmdTy     = String(-ySnap + Math.max(0, topGutterPx));
      outer.dataset.osmdH      = String(hVisible);

      // Single, serialized logger
      logStep(`apply page:${clampedPage+1}/${pages} start:${startIndex} nextStart:${nextStartIndex} h:${hVisible} maskTop:${maskTopWithinMusicPx}`
      );

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
        } as CSSStyleDeclaration);
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
    },
    [pageHeight, topGutterPx, bottomPeekPad, getPAGE_H]
  );

  // --- HEIGHT-ONLY REPAGINATION (no OSMD re-init) ---
  const recomputePaginationHeightOnly = useCallback(
    (resetToFirst: boolean = false, withSpinner: boolean = false): void => {
      const outer = wrapRef.current;
      if (!outer) { return; }

      if (repagRunningRef.current) { return; }   // prevent overlap
      repagRunningRef.current = true;

      outer.dataset.osmdRecompute = String(Date.now());
      const bands = bandsRef.current;
      if (bands.length === 0) {
        outer.dataset.osmdPhase = 'measure:0:repag-abort';
        void logStep('repag: measured 0 bands — abort');
        repagRunningRef.current = false;
        return;
      }

      try {
        if (withSpinner) {
          setBusyMsg(DEFAULT_BUSY);
          setBusy(true);
        }

        const H = getPAGE_H(outer);
        const starts = timeSection("starts:compute", () => computePageStartIndices(bands, H));
        const oldStarts = pageStartsRef.current;

        void logStep(`recompute h=${H} bands=${bands.length} old=${oldStarts.join(',')} new=${starts.join(',')} page=${pageIdxRef.current}`
        );

        pageStartsRef.current = starts;
        outer.dataset.osmdPages = String(starts.length);

        if (resetToFirst) {
          timeSection("apply:first", () => { applyPage(0); });
          void logStep(`recompute: applied page 1 pages=${starts.length}`);
          return;
        }

        const oldPage = pageIdxRef.current;
        const oldStartIdx = oldStarts.length
          ? (oldStarts[Math.max(0, Math.min(oldPage, oldStarts.length - 1))] ?? 0)
          : 0;

        let nearest = 0, best = Number.POSITIVE_INFINITY;
        for (let i = 0; i < starts.length; i++) {
          const s = starts[i]; if (s === undefined) { continue; }
          const d = Math.abs(s - oldStartIdx);
          if (d < best) { best = d; nearest = i; }
        }

        timeSection("apply:nearest", () => { applyPage(nearest); });
        // applyPage(nearest);

      } finally {
        if (withSpinner) {
          hideBusy();
        }

        const queued = reflowAgainRef.current;
        const cause  = reflowQueuedCauseRef.current || "drain:after-repag";
        reflowAgainRef.current = "none";
        reflowQueuedCauseRef.current = "";

        if (queued === "width") {
          window.setTimeout(() => { reflowFnRef.current(true, cause); }, 0);
        } else if (queued === "height") {
          window.setTimeout(() => { repagFnRef.current(true, false); }, 0);
        }

        handledHRef.current = outer.clientHeight || handledHRef.current;
        repagRunningRef.current = false;
      }
    },
    [applyPage, getPAGE_H, hideBusy]
  );

  // keep ref pointing to latest repagination callback
  useEffect(() => {
    repagFnRef.current = recomputePaginationHeightOnly;
  }, [recomputePaginationHeightOnly]);


  const reflowOnWidthChange = useCallback(
    async function reflowOnWidthChange(resetToFirst = false, reflowCause: string = "unknown") {
      const outer = wrapRef.current;
      const osmd  = osmdRef.current;

      let measureWatchdog: number | null = null;

      if (outer) { void logStep("phase:reflowOnWidthChange"); }
      if (!outer || !osmd) {
        const o = outer ? "1" : "0";
        const m = osmd ? "1" : "0";
        if (outer) { void logStep(`reflow:early-bail outer=${o} osmd=${m} cause=${reflowCause}`); }
        return;
      }

      // NEW: stamp the immediate cause of this reflow
      outer.dataset.osmdReflowCause = reflowCause;

      // --- hide the host before render to prevent painting the full SVG ---
      const hostForReflow = hostRef.current;
      const prevVisForReflow = hostForReflow?.style.visibility ?? "";
      const revealHost = () => {
        try {
          if (hostForReflow) {
            hostForReflow.style.visibility = prevVisForReflow || "visible";
            outer.dataset.osmdHostHidden = "0";
          }
        } catch {}
      };

      void logStep(
        `reflow:enter reset=${resetToFirst} running=${reflowRunningRef.current} repag=${repagRunningRef.current} busy=${busyRef.current} cause=${reflowCause}`
      );

      // Increment and stamp the zoom attempt ID
      const nextAttempt = (Number(outer.dataset.osmdZoomAttempt || "0") + 1);
      outer.dataset.osmdZoomAttempt = String(nextAttempt);

      const attempt = nextAttempt;
      outer.dataset.osmdZoomEntered   = String(attempt);
      outer.dataset.osmdZoomEnteredAt = String(Date.now());
      void logStep(`[reflow] ENTER attempt#${attempt} cause=${reflowCause} • ${fmtFlags()}`);

      const ap = makeAfterPaint(outer);

      if (reflowRunningRef.current) {
        reflowAgainRef.current = "width";
        reflowQueuedCauseRef.current = reflowCause;              // remember why we queued
        outer.dataset.osmdZoomQueued   = String(attempt);
        outer.dataset.osmdZoomQueueWhy = "reflowRunning";
        outer.dataset.osmdReflowCauseQueued = reflowCause;
        outer.dataset.osmdZoomQueuedAt = String(Date.now());
        void logStep(`[reflow] QUEUED attempt#${attempt} cause=${reflowCause} • why=reflowRunning • ${fmtFlags()}`);
        return;
      }
      reflowRunningRef.current = true;

      let wd: number | null = null;
      wd = window.setInterval(() => {
        const el = wrapRef.current;
        void logStep(`watchdog: phase=${el?.dataset.osmdPhase ?? "unset"}`);
      }, 2000);

      outer.dataset.osmdPhase = "start";
      const run = (Number(outer.dataset.osmdRun || "0") + 1);
      outer.dataset.osmdRun = String(run);
      void logStep(`reflow:start#${run} reset=${resetToFirst}`);

      try {
        void logStep(
          `reflow:start reset=${resetToFirst} dpr=${window.devicePixelRatio} w=${outer.clientWidth} h=${outer.clientHeight}`
        );
        outer.dataset.osmdPhase = "pre-spinner";

        // Spinner on (with unconditional fail-safe)
        {
          setBusyMsg(DEFAULT_BUSY);
          setBusy(true);

          outer.dataset.osmdPhase = "spinner-requested";
          void logStep("spinner-requested");

          // Commit overlay
          await new Promise<void>((r) => window.setTimeout(r, 0));
          if (document.visibilityState === "visible") {
            await Promise.race([
              new Promise<void>((r) => window.requestAnimationFrame(() => r())),
              new Promise<void>((r) => window.setTimeout(r, 120)),
            ]);
          }

          outer.dataset.osmdPhase = "spinner-on";
          void logStep("spinner-on");

          // Hide host once spinner is visible (prevents flash)
          try {
            if (hostForReflow) {
              hostForReflow.style.visibility = "hidden";
              outer.dataset.osmdHostHidden = "1";
              void logStep("host:hidden(before-render)");
            }
          } catch {}
        }

        // --------- HEAVY RENDER ---------
        const attemptForRender = Number(outer.dataset.osmdZoomEntered || "0");
        outer.dataset.osmdRenderAttempt = String(attemptForRender);
        await logStep(`[render] starting attempt#${attemptForRender}`);

        outer.dataset.osmdPhase = "render";
        await logStep("render:start");
        await new Promise<void>((r) => window.setTimeout(r, 0)); // macrotask
        await ap("render:yield");                         // one paint opportunity

        // Render watchdog
        let renderWd: number | null = window.setTimeout(() => {
          outer.dataset.osmdPhase = "render:watchdog";
          void logStep("render:watchdog:force-finalize");
          hideBusy();
          reflowRunningRef.current = false;
          try { revealHost(); } catch {}
        }, 20000);

        // HEAVY RENDER (timed) + guaranteed watchdog cleanup
        const tRenderStart = tnow();
        try {
          await renderWithEffectiveWidth(outer, osmd);
        } finally {
          if (renderWd !== null) { window.clearTimeout(renderWd); renderWd = null; }
        }
        const tRenderEnd = tnow();

        const renderMs = Math.round(tRenderEnd - tRenderStart);
        outer.dataset.osmdRenderMs = String(renderMs);
        void logStep(`render:finished (${renderMs}ms)`);
        void logStep(`[render] finished attempt#${attemptForRender} (${renderMs}ms)`);

        // --------- BLOCK BRIEFLY AFTER RENDER (zero-wedge version) ---------
        // IMPORTANT: keep host hidden until we have paginated/masked the first page.
        // We'll reveal in the resetToFirst/nearest branches below.
        outer.dataset.osmdPhase = "post-render-wait";
        outer.dataset.osmdPostWaitAt = String(Date.now());
        await logStep("post-render:enter");

        // Give the event loop two clean macrotasks, then move on regardless.
        // (We intentionally do NOT wait on rAF/message here to avoid throttling/wedges.)
        await new Promise<void>((r) => window.setTimeout(r, 0));
        await new Promise<void>((r) => window.setTimeout(r, 0));

        // Stamp deterministic “skip” so logs show we advanced intentionally.
        outer.dataset.osmdPostWaitVia = "skip";
        outer.dataset.osmdPostWaitMs  = "0";
        await logStep("post-render:block done via=skip");

        // mark the phase so the MutationObserver can react
        outer.dataset.osmdPhase = "render:painted";

        // --------- PURGE STRAY CANVASES (same as init; non-blocking) ---------
        try {
          const canvasCount = outer.querySelectorAll("canvas").length;
          void logStep(`purge:probe canvas#=${canvasCount}`);

          if (canvasCount > 0) {
            void logStep("purge:queued");
            window.setTimeout(() => {
              try { purgeWebGL(outer); void logStep("purge:done"); }
              catch (e) { void logStep(`purge:error:${(e as Error)?.message ?? e}`); }
            }, 0);
         } else {
            void logStep("purge:skip(no-canvas)");
          }
        } catch (e) {
          void logStep(`purge:probe:EXC ${(e as Error)?.message ?? String(e)}`);
        }
        
        // --------- MEASURE ---------
        outer.dataset.osmdPhase = "measure";
        void logStep("measure:start");

        // (light watchdog so logs continue even if something stalls)
        if (measureWatchdog !== null) {
          window.clearTimeout(measureWatchdog);
          measureWatchdog = null;
        }
        measureWatchdog = window.setTimeout(() => {
          try {
            outer.dataset.osmdPhase = "measure:watchdog";
            void logStep("measure:watchdog:force-continue");
          } catch {}
        }, 2500);

        const newBands =
          withUntransformedSvg(outer, (svg) =>
            timeSection("measure:scan", () => measureSystemsPx(outer, svg))
          ) ?? [];
        outer.dataset.osmdPhase = `measure:${newBands.length}`;
        void logStep(`measured:${newBands.length}`);
        if (measureWatchdog !== null) {
          window.clearTimeout(measureWatchdog);
          measureWatchdog = null;
        }

        if (newBands.length === 0) {
          outer.dataset.osmdPhase = "measure:0:reflow-abort";
          void logStep("reflow: measured 0 bands — abort");
          // reveal host before returning so user isn't stuck
          revealHost();
          return;
        }

        const prevStarts = pageStartsRef.current.slice();
        const prevPage   = pageIdxRef.current;
        const oldTopIdx  = prevStarts.length
          ? (prevStarts[Math.max(0, Math.min(prevPage, prevStarts.length - 1))] ?? 0)
          : 0;

        bandsRef.current = newBands;

        const newStarts = timeSection(
          "starts:compute",
          () => computePageStartIndices(newBands, getPAGE_H(outer))
        );
        pageStartsRef.current = newStarts;
        outer.dataset.osmdPhase = `starts:${newStarts.length}`;
        void logStep(`starts:${newStarts.length}`);

        if (newStarts.length === 0) {
          outer.dataset.osmdPhase = "reset:first:empty-starts";
          applyPage(0);
          await ap("apply:first-empty");
          applyPage(0);
          outer.dataset.osmdPhase = "reset:first:done";
          void logStep("reset:first:done");
          revealHost();
          return;
        }

        if (resetToFirst) {
          outer.dataset.osmdPhase = "reset:first";
          void logStep("reset:first");
          timeSection("apply:first", () => { applyPage(0); });
          await Promise.race([ap("apply:first"), new Promise<void>((r)=>window.setTimeout(r,400))]);
          timeSection("apply:first", () => { applyPage(0); });
          outer.dataset.osmdPhase = "reset:first:done";
          void logStep("reset:first:done");
          stampHandledDims(outer);
          // Reveal now that first page is applied & masked
          try {
            revealHost();
            await logStep("host:revealed(after-apply:first)");
          } catch {}
          return;
        }

        let nearest = 0, best = Number.POSITIVE_INFINITY;
        for (let i = 0; i < newStarts.length; i++) {
          const s = newStarts[i];
          if (s === undefined) { continue; }
          const d = Math.abs(s - oldTopIdx);
          if (d < best) { best = d; nearest = i; }
        }

        outer.dataset.osmdPhase = `apply-page:${nearest}`;
        void logStep(`apply-page:${nearest}`);

        timeSection("apply:nearest", () => { applyPage(nearest); });
        await Promise.race([
          ap("apply:nearest"),
          new Promise<void>((res) => window.setTimeout(res, 700)),
        ]);
        timeSection("apply:nearest", () => { applyPage(nearest); });

        outer.dataset.osmdPhase = `applied:${nearest}`;
        void logStep(`applied:${nearest}`);
        void logStep(`reflow:done page=${nearest + 1}/${newStarts.length} bands=${newBands.length}`);
        stampHandledDims(outer);

        // Reveal (idempotent): now that page is applied & masked
        try {
          revealHost();
          outer.dataset.osmdHostHidden = "0";
          await logStep("host:revealed(after-apply:nearest)");
        } catch {}

      } finally {
        await logStep("reflow:finally:enter", { paint: true });

        // Safety: ensure host is not left hidden on any path
        try { 
          const nowOuter = wrapRef.current;
          if (nowOuter && nowOuter.dataset.osmdHostHidden !== "0") {
            revealHost();
          }
        } catch {}

        outer.dataset.osmdZoomExited   = outer.dataset.osmdZoomEntered || "0";
        outer.dataset.osmdZoomExitedAt = String(Date.now());
        void logStep(`[reflow] EXIT attempt#${outer.dataset.osmdZoomExited} • ${fmtFlags()}`);

        outer.dataset.osmdPhase = "finally";
        void logStep("finally");

        if (wd !== null) { window.clearInterval(wd); wd = null; }

        hideBusy();
        void logStep("reflow:finally:hid-spinner");

        reflowRunningRef.current = false;

        const queued = reflowAgainRef.current;
        const cause  = reflowQueuedCauseRef.current || "drain:after-reflow";
        reflowAgainRef.current = "none";
        reflowQueuedCauseRef.current = "";
        void logStep(`reflow:finally:queued=${queued} cause=${cause}`);

        if (queued === "width") {
          window.setTimeout(() => {
            void logStep(`reflow:finally:drain:width cause=${cause}`);
            reflowFnRef.current(true, cause);
          }, 0);
        } else if (queued === "height") {
          window.setTimeout(() => {
            void logStep("reflow:finally:drain:height");
            repagFnRef.current(true, false);
          }, 0);
        }

        void logStep("reflow:finally:exit");
      }
    },
    [applyPage, getPAGE_H, hideBusy, renderWithEffectiveWidth, fmtFlags]
  );

  // keep ref pointing to latest width-reflow callback
  useEffect(() => {
    reflowFnRef.current = reflowOnWidthChange;
  }, [reflowOnWidthChange]);

  // WebGL purge
  function purgeWebGL(node: HTMLElement): void {
    for (const c of Array.from(node.querySelectorAll("canvas"))) {
      try {
        const gl =
          (c.getContext("webgl") as WebGLRenderingContext | null) ||
          (c.getContext("experimental-webgl") as WebGLRenderingContext | null) ||
          (c.getContext("webgl2") as WebGL2RenderingContext | null);
        if (gl?.getExtension("WEBGL_lose_context")) {
          (gl.getExtension("WEBGL_lose_context") as { loseContext?: () => void }).loseContext?.();
        }
        c.remove();
      } catch {
        // noop
      }
    }
  }

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) { return; }

    el.dataset.osmdProbeMounted = "1";
    void logStep("probe:mounted");
  }, []);

  // Record baseline zoom/scale at mount (used to compute relative zoom later)
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    const initial = (vv && typeof vv.scale === "number") ? vv.scale : (window.devicePixelRatio || 1);
    baseScaleRef.current = initial || 1;
    zoomFactorRef.current = 1;
  }, []);

  useEffect(() => {
    const onVis = () => {
      const outer = wrapRef.current;
      if (outer) {
        outer.dataset.osmdVisibility = document.visibilityState;
        void logStep(`visibility:${document.visibilityState}`);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    onVis();
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Reflow only for actual zoom; never start immediately, just queue safely.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;

    let lastScale = vv?.scale ?? 1;
    let lastDpr   = window.devicePixelRatio || 1;
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
            reflowFnRef.current(true, `zoom:${why}`); // safe to start now (propagate cause)
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
    let resizeObs: ResizeObserver | null = null;

    (async () => {
      const host = hostRef.current;
      const outer = wrapRef.current;
      if (!host || !outer) { return; }

      await logStep("BUILD: ScoreOSMD v10 @ tick+ap-gate");

      // Phase breadcrumb + first log
      outer.dataset.osmdPhase = "initOSMD";
      await logStep("boot:mount");

      // Create afterPaint helper *before* heavy steps so we can flush logs/spinner
      const ap = makeAfterPaint(outer);

      // --- Dynamic import OSMD ---
      const tImp0 = tnow();
      await logStep("import:OSMD:start");
      const { OpenSheetMusicDisplay: OSMDClass } =
        (await import("opensheetmusicdisplay")) as typeof import("opensheetmusicdisplay");
      void logStep(`import:OSMD:done ${Math.round(tnow() - tImp0)}ms`);

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

      // Spinner on during boot
      setBusyMsg(DEFAULT_BUSY);
      setBusy(true);
      ap("boot");                           // give the overlay a chance to paint

      // --- Load score (string or API/zip) ---
      await logStep("load:begin");
      let loadInput: string | Document | ArrayBuffer | Uint8Array = src;

      if (src.startsWith("/api/")) {
        const res = await fetch(src, { cache: "no-store" });
        if (!res.ok) { throw new Error(`HTTP ${res.status}`); }

        const ab = await withTimeout(res.arrayBuffer(), 12000, "fetch:timeout");
        void logStep(`fetch:bytes:${ab.byteLength}`);
        await logStep("fetch:done");        // flush before unzip work

        // unzipit import
        await logStep("zip:lib:import");
        let unzip!: typeof import("unzipit").unzip;
        try {
          const uz = await withTimeout(import("unzipit"), 4000, "zip:lib:import:timeout");
          ({ unzip } = uz as typeof import("unzipit"));
          await logStep("zip:lib:ready");
        } catch (e) {
          await logStep("zip:lib:error");
          throw e;
        }

        // open zip
        const tZip0 = tnow();
        await logStep("zip:open");
        const { entries } = await withTimeout(unzip(ab), 8000, "zip:open:timeout");
        void logStep(`zip:open: ${Math.round(tnow() - tZip0)}ms`);
        await logStep("zip:opened");

        // container.xml probe
        let entryName: string | undefined;
        await logStep("zip:container:probe");
        const container = entries["META-INF/container.xml"];
        if (container) {
          await logStep("zip:container:read");
          const containerXml = await withTimeout(container.text(), 6000, "zip:container:timeout");

          await logStep("zip:container:parse");
          const cdoc = new DOMParser().parseFromString(containerXml, "application/xml");
          const rootfile = cdoc.querySelector('rootfile[full-path]') || cdoc.querySelector("rootfile");
          const fullPath =
            rootfile?.getAttribute("full-path") ||
            rootfile?.getAttribute("path") ||
            rootfile?.getAttribute("href") ||
            undefined;

          if (fullPath && entries[fullPath]) {
            entryName = fullPath;
            await logStep(`zip:container:selected:${entryName}`);
          } else {
            await logStep("zip:container:no-match");
          }
        } else {
          await logStep("zip:container:missing");
        }

        // scan fallback
        if (!entryName) {
          await logStep("zip:scan:start");
          const candidates = Object.keys(entries).filter((p) => {
            const q = p.toLowerCase();
            return !q.startsWith("meta-inf/") && (q.endsWith(".musicxml") || q.endsWith(".xml"));
          });
          void logStep(`zip:scan:found:${candidates.length}`);

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
          await logStep(`zip:scan:pick:${entryName ?? "(none)"}`);
        }

        if (!entryName) { throw new Error("zip:no-musicxml-in-archive"); }

        // read + parse XML
        await logStep("zip:file:read");
        const entry = entries[entryName];
        if (!entry) { throw new Error(`zip:file:missing:${entryName}`); }

        const xmlText = await withTimeout(entry.text(), 10000, "zip:file:read:timeout");
        await logStep("zip:file:read:ok");
        void logStep(`zip:file:chars:${xmlText.length}`);

        await logStep("xml:parse:start");
        const xmlDoc = new DOMParser().parseFromString(xmlText, "application/xml");
        await logStep("xml:parse:done");

        if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
          throw new Error("MusicXML parse error: XML parsererror");
        }

        const hasPartwise = xmlDoc.getElementsByTagName("score-partwise").length > 0;
        const hasTimewise = xmlDoc.getElementsByTagName("score-timewise").length > 0;
        void logStep(`xml:tags pw=${String(hasPartwise)} tw=${String(hasTimewise)}`);
        if (!hasPartwise && !hasTimewise) {
          throw new Error("MusicXML parse error: no score-partwise/score-timewise");
        }

        const xmlString = new XMLSerializer().serializeToString(xmlDoc);
        await logStep("load:ready");
        loadInput = xmlString;
      } else {
        loadInput = src;
      }

      // --- osmd.load (heartbeat + timing) ---
      await logStep("osmd.load:start");
      const loadStart = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      let loadBeat: number | null = null;

      loadBeat = window.setInterval(() => {
        const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        const secs = Math.round((now - loadStart) / 1000);
        void logStep(`osmd.load:heartbeat +${secs}s`);
      }, 1000);

      try {
        await awaitLoad(osmd, loadInput);
        const durMs = ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - loadStart;
        void logStep(`osmd.load: ${Math.round(durMs)}ms`);
        await logStep("osmd.load:done");
      } finally {
        if (loadBeat !== null) {
          window.clearInterval(loadBeat);
          loadBeat = null;
        }
      }

      // --- Fonts (bounded wait) ---
      await logStep("fonts:waiting");
      await waitForFonts();
      await logStep("fonts:ready");

      // --- First render ---
      const attemptForRender = Number(outer.dataset.osmdZoomEntered || "0");
      outer.dataset.osmdRenderAttempt = String(attemptForRender);
      void logStep(`[render] starting attempt#${attemptForRender}`);

      // Prevent giant paint during render: hide host, keep layout available
      const hostForInit = hostRef.current;
      const prevVisForInit = hostForInit?.style.visibility ?? "";
      if (hostForInit) { hostForInit.style.visibility = "hidden"; }

      outer.dataset.osmdPhase = "render";
      await logStep("render:start");        // flush before heavy sync render
      await new Promise<void>(r => window.setTimeout(r, 0)); // macrotask yield
      await ap("render:yield");             // rAF/message tick

      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      await renderWithEffectiveWidth(outer, osmd);
      const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const renderMs = Math.round(t1 - t0);
      outer.dataset.osmdRenderMs = String(renderMs);
      outer.dataset.osmdRenderEndedAt = String(Date.now());
      void logStep(`render:finished ${renderMs}ms`);
      void logStep(`[render] finished attempt#${attemptForRender} (${renderMs}ms)`);

      // --------- BLOCK BRIEFLY AFTER RENDER (but host still hidden) ---------
      outer.dataset.osmdPhase = "post-render-wait";
      const tPost0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      let via: "ap" | "timeout" = "timeout";

      const race = Promise.race([
        ap("post-render:block:init", 600).then(() => { via = "ap"; }),
        new Promise<void>((r) => window.setTimeout(r, 450)),
      ]);

      // Backstop so we log even if rAF/timers are starved right after render
      const guard = new Promise<void>((r) =>
        window.setTimeout(() => { void logStep("post-render:guard fired (900ms)"); r(); }, 900)
      );

      await Promise.race([race, guard]);

      const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      outer.dataset.osmdPostWaitVia = via;
      outer.dataset.osmdPostWaitMs  = String(Math.round(now - tPost0));
      void logStep(`post-render:block done via=${via} waited=${Math.round(now - tPost0)}ms`);

      // mark the phase so the MutationObserver can react
      outer.dataset.osmdPhase = "render:painted";

      try {
        const canvasCount = outer.querySelectorAll("canvas").length;
        void logStep(`purge:probe canvas#=${canvasCount}`);

        if (canvasCount > 0) {
          void logStep("purge:queued");
          window.setTimeout(() => {
            try { purgeWebGL(outer); void logStep("purge:done"); }
            catch (e) { void logStep(`purge:error:${(e as Error)?.message ?? e}`); }
          }, 0);
        } else {
          void logStep("purge:skip(no-canvas)");
        }

        outer.dataset.osmdPhase = "measure";
        void logStep("measure:start");
        void logStep("diag: entering measure:start await");
      } catch (e) {
        void logStep(`MEASURE-ENTRY:exception:${(e as Error)?.message ?? e}`);
      }
      // Beacons: prove event loop is alive
      try {
        Promise.resolve().then(() => void logStep("beacon:microtask"));
        window.setTimeout(() => void logStep("beacon:setTimeout:100ms"), 100);
        window.setTimeout(() => void logStep("beacon:setTimeout:1000ms"), 1000);
        try { window.requestAnimationFrame(() => void logStep("beacon:raf")); } catch {}
      } catch {}

      // Keep the event loop breathing, but never wedge here.
      await new Promise<void>((r) => window.setTimeout(r, 0)); // macrotask
      // Use our resilient after-paint helper (works even if rAF is throttled)
      await ap("measure:await", 600);

      // --- Measure systems + first pagination ---
      // Force a layout flush so measurements are up-to-date
      void outer.getBoundingClientRect();

      const bands =
        withUntransformedSvg(outer, (svg) =>
          timeSection("measure:scan", () => measureSystemsPx(outer, svg))
      ) ?? [];

      if (bands.length === 0) {
        outer.dataset.osmdPhase = "measure:0:init-abort";
        void logStep("measure:init:0 — aborting first pagination");
        // restore host visibility before returning
        try {
          const hostForInit3 = hostRef.current;
          if (hostForInit3) {
            hostForInit3.style.visibility = prevVisForInit || "visible";
          }
        } catch {}
        hideBusy();
        return;
      }
      bandsRef.current = bands;

      outer.dataset.osmdSvg = String(!!getSvg(outer));
      outer.dataset.osmdBands = String(bands.length);

      const __startsInit = timeSection(
        "starts:compute",
        () => computePageStartIndices(bands, getPAGE_H(outer))
      );
      pageStartsRef.current = __startsInit;
      outer.dataset.osmdPages = String(pageStartsRef.current.length);
      void logStep(`starts:init: ${pageStartsRef.current.join(",")}`);

      pageIdxRef.current = 0;
      timeSection("apply:first", () => { applyPage(0); });
      await ap("apply:first", 450);

      // Reveal host now that first page is applied
      try {
        const hostForInit2 = hostRef.current;
        if (hostForInit2) { hostForInit2.style.visibility = prevVisForInit || "visible"; }
      } catch {}

      // Quick snapshot
      void logStep(`init: svg=${outer.dataset.osmdSvg} bands=${outer.dataset.osmdBands} pages=${outer.dataset.osmdPages}`);

      // Height-only repagination (no spinner) after first paint
      recomputePaginationHeightOnly(true /* resetToFirst */, false /* no spinner */);
      void logStep("repag:init:scheduled");

      // record current handled dimensions
      handledWRef.current = outer.clientWidth;
      handledHRef.current = outer.clientHeight;

      readyRef.current = true;
      hideBusy();

      // --- ResizeObserver to trigger reflow/repag on size changes ---
      if (typeof ResizeObserver !== "undefined") {
        resizeObs = new ResizeObserver(() => {
          if (!readyRef.current) { return; }

          // debounce bursts
          if (resizeTimerRef.current) {
            window.clearTimeout(resizeTimerRef.current);
          }
          resizeTimerRef.current = window.setTimeout(() => {
            resizeTimerRef.current = null;

            const outerNow = wrapRef.current;
            if (!outerNow) { return; }

            const currW = outerNow.clientWidth;
            const currH = outerNow.clientHeight;

            const widthChangedSinceHandled =
              handledWRef.current === -1 || Math.abs(currW - handledWRef.current) >= 1;
            const heightChangedSinceHandled =
              handledHRef.current === -1 || Math.abs(currH - handledHRef.current) >= 1;

            // NEW: trace RO events and deltas
            void logStep(`resize:ro w=${currW} h=${currH} handled=${handledWRef.current}×${handledHRef.current} ΔW=${widthChangedSinceHandled} ΔH=${heightChangedSinceHandled}`
            );

            // --- queue + return if not safe to run now (RO callback) ---
            const kind =
              widthChangedSinceHandled ? "width" :
              (heightChangedSinceHandled ? "height" : "none");

            if (kind === "none") {
              return;
            }

            if (busyRef.current) {
              reflowAgainRef.current = kind;
              reflowQueuedCauseRef.current = `ro:guard-busy:${kind}`;
              return;
            }
            if (reflowRunningRef.current) {
              reflowAgainRef.current = kind;
              reflowQueuedCauseRef.current = `ro:guard-reflow:${kind}`;
              return;
            }
            if (repagRunningRef.current) {
              reflowAgainRef.current = kind;
              reflowQueuedCauseRef.current = `ro:guard-repag:${kind}`;
              return;
            }

            (async () => {
              if (widthChangedSinceHandled) {
                // HORIZONTAL change → full OSMD reflow + reset to page 1
                await reflowFnRef.current(true, "ro:width-change");
                handledWRef.current = currW;
                handledHRef.current = currH;
              } else if (heightChangedSinceHandled) {
                // VERTICAL-only change → cheap repagination (no spinner) + reset to page 1
                repagFnRef.current(true /* resetToFirst */, false /* no spinner */);
                handledHRef.current = currH;
              } else {
                return;
              }
            })();
          }, 200);
        });

        try { resizeObs.observe(outer); } catch {}
      } else {
        void logStep("resize:observer-unavailable (skipping)");
      }
 
    })().catch((err: unknown) => {
      hideBusy();

      const outerNow = wrapRef.current;
      const msg =
        err instanceof Error ? err.message :
        typeof err === "string" ? err :
        JSON.stringify(err);

      if (outerNow) {
        outerNow.setAttribute("data-osmd-step", "init-crash");
        outerNow.dataset.osmdErr = String(msg).slice(0, 180);
        void logStep(`init:crash:${outerNow.dataset.osmdErr}`);
      }
    });

    // Cleanup
    const cleanupOuter = wrapRef.current;

    return () => {
      if (resizeObs) {
        if (cleanupOuter) { resizeObs.unobserve(cleanupOuter); }
        resizeObs.disconnect();
      }

      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }

      if (osmdRef.current) {
        osmdRef.current?.clear();
        (osmdRef.current as { dispose?: () => void } | null)?.dispose?.();
        osmdRef.current = null;
      }
    };
    // Only re-init when source or measure-number mode changes.
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

        const fresh = computePageStartIndices(bandsRef.current, getPAGE_H(outer));
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

  const goNext = useCallback(() => tryAdvance(1),  [tryAdvance]);
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
      if (!readyRef.current ||  busyRef.current || e.touches.length === 0) {
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
    outer.addEventListener("touchmove", onTouchMove,  { passive: false });
    outer.addEventListener("touchend",  onTouchEnd,   { passive: true });

    outer.style.overscrollBehavior = "contain";

    const cleanupOuter = outer;
    return () => {
      cleanupOuter.removeEventListener("touchstart", onTouchStart);
      cleanupOuter.removeEventListener("touchmove", onTouchMove);
      cleanupOuter.removeEventListener("touchend", onTouchEnd);
    };
  }, [goNext, goPrev]);

  // Recompute pagination when the visual viewport height changes (mobile URL/tool bars)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
    if (!vv) { return; }

    const onChange = () => {
      if (!readyRef.current) { return; }

      // debounce vv events
      if (vvTimerRef.current) {
        window.clearTimeout(vvTimerRef.current);
      }
      vvTimerRef.current = window.setTimeout(async () => {
        vvTimerRef.current = null;

        const outerNow = wrapRef.current;
        if (!outerNow) { return; }

        const currW = outerNow.clientWidth;
        const currH = outerNow.clientHeight;

        const widthChanged =
          handledWRef.current === -1 || Math.abs(currW - handledWRef.current) >= 1;
        const heightChanged =
          handledHRef.current === -1 || Math.abs(currH - handledHRef.current) >= 1;

        // NEW: log what VV reported
        void logStep(`vv:change w=${currW} h=${currH} handled=${handledWRef.current}×${handledHRef.current} ΔW=${widthChanged} ΔH=${heightChanged}`
        );

        // --- queue + return if not safe to run now (VV handler) ---
        const kind =
          widthChanged ? "width" :
          (heightChanged ? "height" : "none");

        if (kind === "none") {
          return;
        }

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

        if (widthChanged) {
          // HORIZONTAL change → full OSMD reflow + reset to page 1
          await reflowFnRef.current(true, "vv:width-change");
          handledWRef.current = currW;
          handledHRef.current = currH;
        } else if (heightChanged) {
          // VERTICAL-only change → cheap repagination (no spinner) + reset to page 1
          repagFnRef.current(true /* resetToFirst */, false /* no spinner */);
          handledHRef.current = currH;
        }
      }, 200);
    };

    vv.addEventListener('resize', onChange);
    vv.addEventListener('scroll', onChange);
    return () => {
      vv.removeEventListener('resize', onChange);
      vv.removeEventListener('scroll', onChange);
      // clear the *vv* debounce timer here
      if (vvTimerRef.current) {
        window.clearTimeout(vvTimerRef.current);
        vvTimerRef.current = null;
      }
    };
  }, []);

  // BUSY FLAG MIRROR (debug-only log). Safe to skip: lightweight, no need to await paint.
  // We only mirror the busy state to data-* and emit a single serialized log line.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) { return; }
    el.dataset.osmdBusy = busy ? "1" : "0";
    void logStep(`busy:${busy ? "true" : "false"}`);
  }, [busy]);

  useEffect(() => {
    const outer = wrapRef.current;
    const ov = overlayRef.current;
    if (!outer || !ov) { return; }
    // Read the DOM we just rendered
    const visible = ov.style.display !== 'none';
    outer.dataset.osmdOverlay = visible ? 'shown' : 'hidden';
    void logStep(`overlay:${visible ? 'shown' : 'hidden'} busy=${busy}`);
  }, [busy]);

  // BUSY FAIL-SAFE: if the overlay lingers too long, force-clear and log once.
  // Light breadcrumb only — no need to block on paint here.
  useEffect(() => {
    if (!busy) { return; }

    const t = window.setTimeout(() => {
      const outer = wrapRef.current;
      const host  = hostRef.current;
      const phase = outer?.dataset.osmdPhase ?? "";
      const hostHidden = outer?.dataset.osmdHostHidden === "1" || host?.style.visibility === "hidden";

      // Don’t auto-clear while we’re in heavy phases or the host is intentionally hidden.
      const inHeavy = /^(render|post-render|measure)/.test(phase) || hostHidden;
      if (inHeavy) {
        void logStep(`busy:auto-clear:skipped phase=${phase} hostHidden=${hostHidden ? "1" : "0"}`);
        return;
      }

      hideBusy();
      void logStep("busy:auto-clear");
    }, 20000); // give long-running first renders time to finish

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
        reflowFnRef.current(true, cause);
      }, 0);
    } else if (queued === "height") {
      window.setTimeout(() => {
        void logStep("queue:drain:height");
        repagFnRef.current(true, false);
      }, 0);
    }
  }, [busy]);

  // Auto-dump once if we linger in render:painted (no keys required)
  useEffect(() => {
    const outer = wrapRef.current;
    if (!outer) { return; }

    let timer: number | null = null;
    let armed = false;

    const arm = (): void => {
      if (timer !== null) { window.clearTimeout(timer); }
      timer = window.setTimeout(() => {
        const now = wrapRef.current;
        if (now && now.dataset.osmdPhase === "render:painted" && !armed) {
          armed = true;
          dumpDebug();
        }
      }, 1200);
    };

    const mo = new MutationObserver(() => {
      const now = wrapRef.current;
      const ph = now?.dataset.osmdPhase;
      if (now && (ph === "render:painted" || ph === "post-render-wait")) {
        arm();
      } else {
        if (timer !== null) { window.clearTimeout(timer); timer = null; }
      }
    });

    mo.observe(outer, { attributes: true, attributeFilter: ["data-osmd-phase"] });

    // If we're already in one of the phases, arm immediately
    if (outer.dataset.osmdPhase === "render:painted" || outer.dataset.osmdPhase === "post-render-wait") {
      arm();
    }

    return (): void => {
      mo.disconnect();
      if (timer !== null) { window.clearTimeout(timer); }
    };
  }, [dumpDebug]);

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
    contain: "layout style paint",   // ← add this line
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
      {/* Tiny fixed debug button (on top of overlay) */}
      <button
        type="button"
        onClick={() => dumpDebug()}
        style={{
          position: "fixed",
          top: 8,
          right: 8,
          zIndex: 10000,          // higher than the overlay (overlay is 9999)
          pointerEvents: "auto",  // ensure it can be clicked even over overlay
          background: "#111",
          color: "#0f0",
          border: "1px solid #0f0",
          borderRadius: 6,
          padding: "4px 6px",
          fontSize: 11,
          fontFamily: "monospace",
          cursor: "pointer",
          opacity: 0.9,
          userSelect: "none"
        }}
        aria-label="Dump debug info"
      >
        DBG
      </button>

      <style>{`@keyframes osmd-spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
