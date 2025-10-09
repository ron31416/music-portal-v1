// src/app/viewer/page.tsx
import RedirectToSandbox from "../../components/RedirectToSandbox";
import ViewerClient from "./viewer-client";
import SongListPanel from "@/components/SongListPanel";

export const dynamic = "force-dynamic";

export default function ViewerPage() {
  return (
    <main className="p-4">
      {/* Mount the redirect first so it runs immediately */}
      <RedirectToSandbox />
      <ViewerClient />
      {/* --- Student Song List (DB-backed) --- */}
      <div style={{ marginTop: 24 }}>
        <SongListPanel />
      </div>
    </main>
  );
}
