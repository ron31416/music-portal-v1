// src/app/viewer/page.tsx
import RedirectToSandbox from "../../components/RedirectToSandbox";
import ViewerClient from "./viewer-client";

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
