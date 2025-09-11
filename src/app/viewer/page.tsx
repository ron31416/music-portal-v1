// app/viewer/page.tsx
import { Suspense } from "react";
import ViewerClient from "./viewer-client";

export const dynamic = "force-dynamic"; // avoid caching while iterating

export default function ViewerPage() {
  return (
    <main className="p-4">
      <Suspense fallback={<p>Loading viewer…</p>}>
        <ViewerClient />
      </Suspense>
    </main>
  );
}
