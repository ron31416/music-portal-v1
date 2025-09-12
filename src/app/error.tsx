// src/app/error.tsx
"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Optional: send to your logging service
    // console.error(error);
  }, [error]);

  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>Something went wrong</h1>
      <p style={{ marginBottom: 16 }}>
        An unexpected error occurred. You can try again.
      </p>
      <button
        onClick={() => reset()}
        style={{
          padding: "8px 12px",
          borderRadius: 6,
          border: "1px solid #ccc",
          background: "#f5f5f5",
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </main>
  );
}
