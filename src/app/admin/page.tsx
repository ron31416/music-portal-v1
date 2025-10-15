// src/app/admin/page.tsx
"use client";

import React from "react";
import { usePrefersDark, themeTokens } from "@/lib/theme";

export default function AdminHubPage(): React.ReactElement {
  const isDark = usePrefersDark();
  const T = themeTokens(isDark);

  function goSongs(): void {
    window.open("/admin/songs", "_blank", "noopener,noreferrer");
  }

  function goUsers(): void {
    window.open("/admin/users", "_blank", "noopener,noreferrer");
  }

  return (
    <main
      id="admin-hub"
      style={{
        minHeight: "100vh",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        background: T.bg,
        color: T.fg,
      }}
    >
      <button id="hub-songs-btn" type="button" onClick={goSongs}>
        Songs
      </button>

      <button id="hub-users-btn" type="button" onClick={goUsers}>
        Users
      </button>

      {/* Scoped guardrails against stray global CSS (use !important to beat resets) */}
      <style jsx global>{`
        #admin-hub {
          background: ${T.bg} !important;
          color: ${T.fg} !important;
        }

        /* Base style for both hub buttons */
        #hub-songs-btn,
        #hub-users-btn {
          border-radius: 12px !important;
          border: 1px solid ${T.border} !important;
          padding: 10px 18px !important;
          background: ${T.panelBg} !important;
          color: ${T.fg} !important;
          font: inherit !important;
          line-height: 1.2 !important;
          display: inline-block !important;
          cursor: pointer !important;
          box-shadow: none !important;
          text-decoration: none !important;
          /* Recover from aggressive resets */
          appearance: button !important;
          -webkit-appearance: button !important;
        }

        /* Disabled look for Users */
        #hub-users-btn[disabled] {
          cursor: not-allowed !important;
          opacity: 0.6 !important;
        }

        /* Optional hover for Songs */
        #hub-songs-btn:hover {
          box-shadow: 0 1px 6px rgba(0, 0, 0, ${isDark ? "0.4" : "0.15"}) !important;
        }
      `}</style>
    </main>
  );
}
