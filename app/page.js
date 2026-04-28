// deploy trigger
"use client";

import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: "40px", fontFamily: "Arial, sans-serif" }}>
      <h1>Performance Readiness System</h1>

      <p style={{ marginTop: "10px" }}>
        Track athlete readiness, monitor training load, and optimize performance.
      </p>

      <div style={{ marginTop: "30px" }}>
        <Link href="/login-signup">
          <button style={{ padding: "12px 20px", marginRight: "10px" }}>
            Login / Sign Up
          </button>
        </Link>

        <Link href="/coach">
          <button style={{ padding: "12px 20px", marginRight: "10px" }}>
            Coach Dashboard
          </button>
        </Link>

        <Link href="/athlete">
          <button style={{ padding: "12px 20px" }}>
            Athlete Dashboard
          </button>
        </Link>
      </div>
    </main>
  );
}