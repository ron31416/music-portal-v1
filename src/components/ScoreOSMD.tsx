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
  initialZoom?: number; // default: 0.9 (90%)
  topGutterPx?: number; // default: 3 (small white space at very top)
  debugShowAllMeasureNumbers?: boolean; // default: false (dev aid)
}

interface Band { top: number; bottom: number; height: number }
interface OSMDZoomable { Zoom: number }


// Device-dependent guard to prevent bottom-of-page leakage on some mobiles
function leakGuardPx(): number {
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
  // Base 8px, scaled a bit with DPR to avoid subpixel rounding leaks
  return Math.max(8, Math.ceil(dpr * 6));
}

const afterPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });

const isPromise = (x: unknown): x is Promise<unknown> =>
  typeof x === "object" && x !== null && typeof (x as { then?: unknown }).then === "function";

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

/** Wait for web fonts to be ready to avoid late reflow on mobile */
async function waitForFonts(): Promise<void> {
  try {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) {
      await fonts.ready;
    }
  } catch {
    // no-op
  }
}

/** Track the *visible* viewport height (accounts for mobile URL/tool bars) */
function useVisibleViewportHeight() {
  const vpRef = useRef<number>(0);
  const [, force] = React.useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const update = () => {
      const h =
        (window.visualViewport && Math.floor(window.visualViewport.height)) ||
        Math.floor(document.documentElement.clientHeight);
      if (h && h !== vpRef.current) {
        vpRef.current = h;
        force();
      }
    };
    update();
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
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
      const MIN_H = 4;   // was 8
      const MIN_W = 16;  // was 40
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
      if (!next) {
        break;
      }
      const isFirstPage = starts.length === 0 && i === 0;
      const slack = isFirstPage && fuseTitle ? Math.max(12, Math.round(viewportH * 0.06)) : 0;

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

/* ---------- Component ---------- */

export default function ScoreOSMD({
  src,
  fillParent = true,
  height = 600,
  className = "",
  style,
  initialZoom = 0.9, // default to 90%
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
  const [busyMsg, setBusyMsg] = useState<string>(DEFAULT_BUSY);

  const vpHRef = useVisibleViewportHeight();

  const getViewportH = useCallback(
    (outer: HTMLDivElement): number => {
      const v = vpHRef.current;
      const raw = v > 0 ? Math.min(v, outer.clientHeight || v) : outer.clientHeight || 0;
      return Math.max(0, raw - Math.max(0, topGutterPx));
    },
    [vpHRef, topGutterPx]
  );

  /** Ensure OSMD zoom is applied before every render */
  const applyZoom = useCallback((): void => {
    const osmd = osmdRef.current as unknown as OSMDZoomable | null;
    if (osmd) {
      const z = Math.max(0.5, Math.min(3, initialZoom ?? 0.9));
      osmd.Zoom = z;
    }
  }, [initialZoom]);

  /** Apply a page index */
  const applyPage = useCallback(
    (pageIdx: number): void => {
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

      const hVisible = getViewportH(outer);

      const maskTopWithinMusicPx = (() => {
        if (nextStartIndex < 0) {
          return hVisible;
        }
        const nextBand = bands[nextStartIndex];
        if (!nextBand) {
          return hVisible;
        }
        const nextTopRel = nextBand.top - startBand.top;
        const overlap = leakGuardPx();
        return Math.min(hVisible - 1, Math.max(0, Math.ceil(nextTopRel - overlap)));
      })();

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
    [getViewportH, topGutterPx]
  );

  /** Recompute height-only pagination */
  const recomputePaginationHeightOnly = useCallback((): void => {
    const outer = wrapRef.current;
    if (!outer) {
      return;
    }

    const bands = bandsRef.current;
    if (bands.length === 0) {
      return;
    }

    const starts = computePageStartIndices(bands, getViewportH(outer));
    const oldStarts = pageStartsRef.current;
    pageStartsRef.current = starts;

    const oldPage = pageIdxRef.current;
    const oldStartIdx = oldStarts.length
      ? oldStarts[Math.max(0, Math.min(oldPage, oldStarts.length - 1))] ?? 0
      : 0;

    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i];
      if (s === undefined) {
        continue;
      }
      const d = Math.abs(s - oldStartIdx);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    applyPage(nearest);
  }, [applyPage, getViewportH]);

  /** Full reflow on width change (heavy) */
  const reflowOnWidthChange = useCallback(async (): Promise<void> => {
    const outer = wrapRef.current;
    const osmd = osmdRef.current;
    if (!outer || !osmd) {
      return;
    }

    const oldStarts = pageStartsRef.current;
    const oldPage = pageIdxRef.current;
    const oldTopSystem =
      oldStarts.length ? oldStarts[Math.max(0, Math.min(oldPage, oldStarts.length - 1))] ?? 0 : 0;

    setBusyMsg(DEFAULT_BUSY);
    setBusy(true);
    await afterPaint();

    applyZoom();
    osmd.render();
    await afterPaint();

    const newBands = withUntransformedSvg(outer, (svg) => measureSystemsPx(outer, svg)) ?? [];
    if (newBands.length === 0) {
      setBusy(false);
      setBusyMsg(DEFAULT_BUSY);
      return;
    }
    bandsRef.current = newBands;

    const newStarts = computePageStartIndices(newBands, getViewportH(outer));
    pageStartsRef.current = newStarts;

    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < newStarts.length; i++) {
      const s = newStarts[i];
      if (s === undefined) {
        continue;
      }
      const d = Math.abs(s - oldTopSystem);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    applyPage(nearest);

    setBusy(false);
    setBusyMsg(DEFAULT_BUSY);
  }, [applyZoom, applyPage, getViewportH]);

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

  /** Init OSMD */
  useEffect(() => {
    let resizeObs: ResizeObserver | null = null;
    let lastW = -1;
    let lastH = -1;

    (async () => {
      const host = hostRef.current;
      const outer = wrapRef.current;
      if (!host || !outer) {
        return;
      }

      const { OpenSheetMusicDisplay } =
        (await import("opensheetmusicdisplay")) as typeof import("opensheetmusicdisplay");

      if (osmdRef.current) {
        osmdRef.current?.clear();
        (osmdRef.current as { dispose?: () => void } | null)?.dispose?.();
        osmdRef.current = null;
      }
      const osmd = new OpenSheetMusicDisplay(host, {
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

      setBusyMsg(DEFAULT_BUSY);
      setBusy(true);
      await afterPaint();

      const maybe = osmd.load(src);
      if (isPromise(maybe)) {
        await maybe;
      }

      applyZoom();

      await waitForFonts();
      osmd.render();
      await afterPaint();

      purgeWebGL(outer);

      const bands = withUntransformedSvg(outer, (svg) => measureSystemsPx(outer, svg)) ?? [];
      bandsRef.current = bands;

      pageStartsRef.current = computePageStartIndices(bands, getViewportH(outer));
      pageIdxRef.current = 0;
      applyPage(0);

      readyRef.current = true;

      setBusy(false);
      setBusyMsg(DEFAULT_BUSY);

      resizeObs = new ResizeObserver(() => {
        if (!readyRef.current) {
          return;
        }
        const w = outer.clientWidth;
        const h = outer.clientHeight;

        const widthChanged = lastW !== -1 && Math.abs(w - lastW) >= 1;
        const heightChanged = lastH !== -1 && Math.abs(h - lastH) >= 1;

        lastW = w;
        lastH = h;

        if (widthChanged) {
          void reflowOnWidthChange();
        } else if (heightChanged) {
          recomputePaginationHeightOnly();
        }
      });
      resizeObs.observe(outer);
      lastW = outer.clientWidth;
      lastH = outer.clientHeight;
    })().catch(() => {
      setBusy(false);
      setBusyMsg(DEFAULT_BUSY);
    });

    const cleanupOuter = wrapRef.current;
    return () => {
      if (resizeObs && cleanupOuter) {
        resizeObs.unobserve(cleanupOuter);
      }
      if (osmdRef.current) {
        osmdRef.current?.clear();
        (osmdRef.current as { dispose?: () => void } | null)?.dispose?.();
        osmdRef.current = null;
      }
    };
  }, [applyZoom, applyPage, recomputePaginationHeightOnly, reflowOnWidthChange, src, getViewportH]);

  /** Paging helpers */
  const goNext = useCallback((): void => {
    if (busy) {
      return;
    }
    const pages = pageStartsRef.current.length;
    if (!pages) {
      return;
    }
    const next = Math.min(pageIdxRef.current + 1, pages - 1);
    if (next !== pageIdxRef.current) {
      applyPage(next);
    }
  }, [applyPage, busy]);

  const goPrev = useCallback((): void => {
    if (busy) {
      return;
    }
    const prev = Math.max(pageIdxRef.current - 1, 0);
    if (prev !== pageIdxRef.current) {
      applyPage(prev);
    }
  }, [applyPage, busy]);

  // Wheel & keyboard paging (disabled while busy)
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!readyRef.current || busy) {
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
      if (!readyRef.current || busy) {
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
  }, [applyPage, goNext, goPrev, busy]);

  // Touch swipe paging (disabled while busy)
  useEffect(() => {
    const outer = wrapRef.current;
    if (!outer) {
      return;
    }

    let startY = 0;
    let startX = 0;
    let active = false;

    const onTouchStart = (e: TouchEvent) => {
      if (!readyRef.current || busy || e.touches.length === 0) {
        return;
      }
      active = true;
      startY = e.touches[0]?.clientY ?? 0;
      startX = e.touches[0]?.clientX ?? 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!active || !readyRef.current || busy) {
        return;
      }
      e.preventDefault();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!active) {
        return;
      }
      active = false;
      if (busy) {
        return;
      }
      const t = e.changedTouches[0];
      if (!t) {
        return;
      }

      const dy = t.clientY - startY;
      const dx = t.clientX - startX;

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
  }, [goNext, goPrev, busy]);

  // Recompute pagination when the visual viewport height changes (mobile URL/tool bars)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
    if (!vv) {
      return;
    }
    let raf = 0;
    const onChange = () => {
      if (!readyRef.current) {
        return;
      }
      if (raf) {
        cancelAnimationFrame(raf);
      }
      raf = requestAnimationFrame(() => {
        recomputePaginationHeightOnly();
      });
    };
    vv.addEventListener('resize', onChange);
    vv.addEventListener('scroll', onChange);
    return () => {
      vv.removeEventListener('resize', onChange);
      vv.removeEventListener('scroll', onChange);
      if (raf) {
        cancelAnimationFrame(raf);
      }
    };
  }, [recomputePaginationHeightOnly]);

  /* ---------- Styles ---------- */

  const isFill = fillParent;
  const outerStyle: React.CSSProperties = isFill
    ? {
        width: "100%",
        height: vpHRef.current > 0 ? vpHRef.current : "100%",
        minHeight: 0,
        position: "relative",
        overflow: "hidden",
        background: "#fff",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2px)",
        boxSizing: "border-box",
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
      };

  const hostStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    minWidth: 0,
  };

  /* ---------- Busy overlay ---------- */
  const blockerStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    zIndex: 50,
    display: busy ? "grid" : "none",
    placeItems: "center",
    background: "rgba(0,0,0,0.25)",
    backdropFilter: "blur(2px)",
    cursor: "wait",
  };

  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={wrapRef} className={className} style={{ ...outerStyle, ...style }}>
      <div ref={hostRef} style={hostStyle} />
      {/* Input-blocking overlay while busy */}
      <div
        aria-busy={busy}
        role="status"
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
        onKeyDown={stop}
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
