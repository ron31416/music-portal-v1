'use client';
import { useEffect } from 'react';

const APEX = process.env.NEXT_PUBLIC_APEX_DOMAIN ?? 'ronsmusicstore.com';

function makeSlug(len = 10): string {
    try {
        const arr = new Uint8Array(len);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => (b % 36).toString(36)).join('');
    } catch {
        return Math.random().toString(36).slice(2, 2 + len);
    }
}

export default function RedirectToSandbox() {
    useEffect(() => {
        try {
            const { protocol, hostname, pathname, search, hash } = window.location;

            // Debug escape hatch: append ?nosandbox=1 to stay on apex/www
            if (new URLSearchParams(search).has('nosandbox')) { return; }

            const onHttps = protocol === 'https:';
            const isExactApex = hostname === APEX;
            const isWww = hostname === `www.${APEX}`;

            // Redirect only from apex or www to a random subdomain
            if (onHttps && (isExactApex || isWww)) {
                const slug = makeSlug(10);
                const target = `${protocol}//${slug}.${APEX}${pathname}${search}${hash}`;
                window.location.replace(target); // no history entry
            }
        } catch { }
    }, []);

    return null;
}
