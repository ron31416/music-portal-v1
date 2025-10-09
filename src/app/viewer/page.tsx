// src/app/viewer/page.tsx

import ViewerClient from "./viewer-client";
import RedirectToSandbox from "../../components/RedirectToSandbox";

export const dynamic = "force-dynamic";

export default function ViewerPage() {
  return (
    <main className="p-4">
      {/* Mount the redirect first so it runs immediately */}
      <RedirectToSandbox />
      <ViewerClient />
    </main>
  );
}
