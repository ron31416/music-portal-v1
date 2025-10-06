// src/lib/sandboxUrl.ts
const APEX = process.env.NEXT_PUBLIC_APEX_DOMAIN || "";

/** True when we’re running under the production apex/wildcard host */
function isProdLikeHost(h: string): boolean {
    if (!APEX) { return false; }
    return h === APEX || h.endsWith("." + APEX);
}

/** Short, DNS-safe random slug (lowercase letters+digits) */
function randSlug(len = 10): string {
    // Use crypto when available; otherwise Math.random fallback
    try {
        const arr = new Uint8Array(len);
        crypto.getRandomValues(arr);
        // map each byte into 0..35 and convert to base36 (0-9a-z)
        return Array.from(arr, b => (b % 36).toString(36)).join("");
    } catch {
        return Math.random().toString(36).slice(2, 2 + len);
    }
}

/**
 * Build a sandboxed URL on a fresh subdomain so Chrome’s per-origin zoom is isolated.
 * In dev/preview (no wildcard), we stay on the current host.
 */
export function makeSandboxUrl(path: string): string {
    const proto = typeof window !== "undefined" && window.location?.protocol === "http:" ? "http:" : "https:";
    const here = typeof window !== "undefined" ? window.location : null;
    const pathname = path.startsWith("/") ? path : `/${path}`;

    if (here && isProdLikeHost(here.hostname)) {
        const slug = randSlug(10);
        return `${proto}//${slug}.${APEX}${pathname}`;
    }

    // Dev/preview fallback: no subdomain switch (zoom isolation won’t apply locally)
    const host = here ? here.host : APEX;
    return `${proto}//${host}${pathname}`;
}
