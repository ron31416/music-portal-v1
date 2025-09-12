// src/app/loading.tsx
export default function Loading() {
  return (
    <main style={{ padding: 24 }}>
      <div
        aria-busy="true"
        aria-live="polite"
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          border: "4px solid #eee",
          borderTopColor: "#999",
          animation: "spin 1s linear infinite",
        }}
      />
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </main>
  );
}
