// src/app/not-found.tsx
export default function NotFound() {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>Page not found</h1>
      <p style={{ marginBottom: 16 }}>
        The page you’re looking for doesn’t exist or has moved.
      </p>
      <a href="/" style={{ textDecoration: "underline" }}>Go back home</a>
    </main>
  );
}
