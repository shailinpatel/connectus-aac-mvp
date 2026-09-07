"use client";
import { useState } from "react";
import { Heart, LockKeyhole, Volume2 } from "lucide-react";
import { api } from "@/lib/client-api";
import { clearSavedBoard } from "@/lib/offline";
export function AccountGate() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn() {
    setBusy(true);
    setError("");
    try {
      await clearSavedBoard();
      const { url } = await api<{ url: string }>("/auth/google", {
        method: "POST",
      });
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start sign-in.");
      setBusy(false);
    }
  }
  return (
    <main className="account-welcome" id="account" tabIndex={-1}>
      <div className="welcome-story">
        <span className="section-eyebrow">
          A LITTLE SUPPORT. MORE CONNECTION.
        </span>
        <h1>
          Their words.
          <br />A space of their own.
        </h1>
        <p>
          A familiar board for everyday needs, feelings, and the things that
          matter.
        </p>
        <div className="welcome-pictures" aria-hidden="true">
          <div>
            <img src="/pictograms/hello.png" alt="" />
            <span>Hello</span>
          </div>
          <div>
            <img src="/pictograms/love.png" alt="" />
            <span>I love you</span>
          </div>
          <div>
            <img src="/pictograms/help.png" alt="" />
            <span>Help</span>
          </div>
        </div>
      </div>
      <section className="account-card" aria-labelledby="account-heading">
        <span className="account-heart">
          <Heart size={29} />
        </span>
        <h2 id="account-heading">Welcome, caregivers</h2>
        <p>Sign in to create or open your private communication board.</p>
        <button
          className="button google-button"
          onClick={signIn}
          disabled={busy}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"
            />
            <path
              fill="#34A853"
              d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.82-1.76-5.61-4.12H3.05v2.59A10 10 0 0 0 12 22Z"
            />
            <path
              fill="#FBBC05"
              d="M6.39 13.93A6 6 0 0 1 6.07 12c0-.67.12-1.32.32-1.93V7.48H3.05A10 10 0 0 0 2 12c0 1.61.38 3.14 1.05 4.52l3.34-2.59Z"
            />
            <path
              fill="#EA4335"
              d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.61 9.61 0 0 0 12 2a10 10 0 0 0-8.95 5.48l3.34 2.59C7.18 7.71 9.4 5.95 12 5.95Z"
            />
          </svg>
          {busy ? "Opening Google…" : "Continue with Google"}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="account-notes">
          <p>
            <LockKeyhole size={18} />
            Your board and photos belong to your account.
          </p>
          <p>
            <Volume2 size={18} />
            Children can use the board without their own login.
          </p>
        </div>
        <p className="helper">
          On a shared device, sign out when you finish. This removes your saved
          board and photos from this browser.
        </p>
      </section>
    </main>
  );
}
