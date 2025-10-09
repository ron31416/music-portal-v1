// src/app/page.tsx

import SongListPanel from "@/components/SongListPanel";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6">
      <h1 className="text-3xl font-semibold">Music Portal</h1>

      <section style={{ marginTop: 24 }}>
        <SongListPanel />
      </section>
    </main>
  );
}
