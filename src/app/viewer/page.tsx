// src/app/viewer/page.tsx
import { Suspense } from "react";
import ViewerClient from "./viewer-client";

export const dynamic = "force-dynamic";

export default async function ViewerPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string }>;
}) {
  const { src } = await searchParams; // ← await is required in Next 15

  return (
    <main className="p-4">
      {!src ? (
        <p style={{ color: "crimson" }}>
          Missing <code>?src=…</code> (try: <code>/viewer?src=/api/songs/2/mxl</code>)
        </p>
      ) : (
        <Suspense fallback={<p>Loading viewer…</p>}>
          <ViewerClient src={src} />
        </Suspense>
      )}
    </main>
  );
}
