import React, { useState } from "react";
import { login } from "./api.js";

/*
  Re:Learn Login
  Standalone component: styling is included in this file.
  Usage:
    <Login onSwitch={() => ...} onSuccess={(user) => ...} onBack={() => ...} />
*/

const styles = `
  .relearn-auth-page {
    --ink: #101c4d;
    --muted: #59617d;
    --brand: #e45c4c;
    --brand-dark: #d84f40;
    --page: #f7f7fb;
    --white: #ffffff;
    --line: #c9cbd8;
    --line-2: #e3e4ec;
    --font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;

    min-height: 100vh;
    box-sizing: border-box;
    padding: 28px 24px 60px;
    color: var(--ink);
    font-family: var(--font);
    background:
      radial-gradient(circle at 80% 25%, rgba(107, 91, 230, .12), transparent 30%),
      linear-gradient(135deg, #f7f7fb 0%, #eeeeF7 100%);
  }

  .relearn-auth-page *,
  .relearn-auth-page *::before,
  .relearn-auth-page *::after {
    box-sizing: border-box;
  }

  .relearn-auth-container {
    width: min(1120px, 100%);
    margin: 0 auto;
  }

  .relearn-auth-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 44px;
  }

  .relearn-auth-logo {
    border: 0;
    background: transparent;
    color: var(--ink);
    font-size: 25px;
    font-weight: 800;
    letter-spacing: -1px;
    cursor: pointer;
    padding: 4px 0;
  }

  .relearn-auth-logo b {
    color: var(--brand);
  }

  .relearn-auth-back {
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: 14px;
    cursor: pointer;
  }

  .relearn-auth-back:hover {
    color: var(--ink);
  }

  .relearn-auth-grid {
    display: grid;
    grid-template-columns: minmax(0, 520px) minmax(300px, 1fr);
    gap: 72px;
    align-items: center;
  }

  .relearn-auth-card {
    width: 100%;
    background: rgba(255,255,255,.68);
    border: 1px solid var(--line-2);
    border-radius: 28px;
    padding: 40px;
    box-shadow: 0 30px 70px -35px rgba(70,55,214,.5);
    backdrop-filter: blur(8px);
  }

  .relearn-auth-pretitle {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    padding: 9px 19px;
    border: 1px solid var(--line);
    border-radius: 999px;
    color: var(--ink);
    font-size: 14px;
    margin-bottom: 20px;
  }

  .relearn-auth-pretitle::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--brand);
  }

  .relearn-auth-card h1 {
    margin: 0;
    color: var(--ink);
    font-size: clamp(34px, 4vw, 48px);
    line-height: 1.02;
    letter-spacing: -1.8px;
  }

  .relearn-auth-sub {
    margin: 18px 0 34px;
    color: var(--muted);
    font-size: 16px;
    line-height: 1.55;
  }

  .relearn-auth-form label {
    display: block;
    width: 100%;
    color: var(--ink);
    font-size: 15px;
    font-weight: 500;
    margin: 0 0 16px;
  }

  .relearn-auth-form input {
    display: block;
    box-sizing: border-box;
    width: 100%;
    height: 54px;
    margin: 8px 0 0;
    padding: 0 20px;
    background: var(--page);
    border: 1px solid var(--line);
    border-radius: 999px;
    color: var(--ink);
    font: 500 15px var(--font);
    outline: none;
    transition: border-color .2s ease, box-shadow .2s ease, background .2s ease;
  }

  .relearn-auth-form input::placeholder {
    color: #7d8095;
  }

  .relearn-auth-form input:focus {
    border-color: #7b6ff2;
    background: #fff;
    box-shadow: 0 0 0 4px rgba(91,75,245,.10);
  }

  .relearn-auth-error {
    margin: 4px 0 16px;
    padding: 11px 15px;
    border-radius: 14px;
    background: #fff0ed;
    color: #b43d31;
    font-size: 13px;
    line-height: 1.4;
  }

  .relearn-auth-submit {
    width: 100%;
    height: 54px;
    margin-top: 4px;
    border: 0;
    border-radius: 999px;
    background: var(--brand);
    color: white;
    font: 700 15px var(--font);
    cursor: pointer;
    box-shadow: 0 12px 25px -12px rgba(228,92,76,.7);
    transition: transform .15s ease, background .15s ease, box-shadow .15s ease;
  }

  .relearn-auth-submit:hover {
    background: var(--brand-dark);
    transform: translateY(-1px);
    box-shadow: 0 15px 28px -12px rgba(228,92,76,.75);
  }

  .relearn-auth-switch {
    margin: 20px 0 0;
    text-align: center;
    color: var(--muted);
    font-size: 14px;
  }

  .relearn-auth-switch button {
    border: 0;
    padding: 0;
    margin-left: 5px;
    background: transparent;
    color: #5145c8;
    font: inherit;
    cursor: pointer;
  }

  .relearn-auth-note {
    margin: 25px 0 0;
    text-align: center;
    color: #646b86;
    font-size: 12px;
  }

  .relearn-auth-code-area {
    max-width: 510px;
  }

  .relearn-code {
    overflow: hidden;
    border: 1px solid #262746;
    border-radius: 18px;
    background: #11122b;
    box-shadow: 0 30px 70px -35px rgba(20,20,55,.55);
  }

  .relearn-code-bar {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 42px;
    padding: 0 14px;
    border-bottom: 1px solid rgba(255,255,255,.08);
    color: #aeb0c7;
    font-size: 12px;
  }

  .relearn-code-bar i {
    width: 8px;
    height: 8px;
    display: block;
    border-radius: 50%;
    background: #e45c4c;
  }

  .relearn-code-bar i:nth-child(2) { background: #e2bd57; }
  .relearn-code-bar i:nth-child(3) { background: #65b875; }

  .relearn-code pre {
    margin: 0;
    padding: 22px 24px;
    overflow: auto;
    color: #d9daf0;
    font: 14px/1.9 "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  }

  .relearn-code .ln {
    display: block;
    white-space: pre;
    padding: 0 10px;
    border-radius: 7px;
  }

  .relearn-code .ln.hot {
    background: rgba(228,92,76,.15);
    color: #fff;
  }

  .relearn-auth-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-top: 24px;
    padding: 8px 13px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: rgba(255,255,255,.45);
    color: var(--ink);
    font-size: 13px;
  }

  .relearn-auth-badge .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--brand);
  }

  .relearn-auth-code-area > p {
    margin: 12px 0 0;
    color: var(--muted);
    font-size: 15px;
  }

  @media (max-width: 850px) {
    .relearn-auth-grid {
      grid-template-columns: 1fr;
      gap: 35px;
    }

    .relearn-auth-code-area {
      max-width: 100%;
    }
  }

  @media (max-width: 560px) {
    .relearn-auth-page {
      padding: 20px 15px 40px;
    }

    .relearn-auth-nav {
      margin-bottom: 25px;
    }

    .relearn-auth-card {
      padding: 28px 22px;
      border-radius: 24px;
    }

    .relearn-auth-card h1 {
      font-size: 35px;
    }
  }
`;

export default function Login({ onSwitch, onSuccess, onBack }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const user = await login(email, password);
      localStorage.setItem("relearn-session", JSON.stringify(user));
      if (onSuccess) onSuccess(user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const lines = [
    "session = login(email)",
    "problem = next_problem()",
    "solution = write_code()",
    "result = evaluate(solution)",
  ];

  return (
    <>
      <style>{styles}</style>

      <div className="relearn-auth-page">
        <div className="relearn-auth-container relearn-auth-nav">
          <button className="relearn-auth-logo" onClick={onBack}>
            Re<b>:</b>Learn
          </button>

          <button className="relearn-auth-back" onClick={onBack}>
            ← Back to home
          </button>
        </div>

        <div className="relearn-auth-container relearn-auth-grid">
          <div className="relearn-auth-card">
            <span className="relearn-auth-pretitle">Welcome back</span>

            <h1>Continue your coding journey.</h1>

            <p className="relearn-auth-sub">
              Open your dashboard and pick up where you left off.
            </p>

            <form className="relearn-auth-form" onSubmit={submit}>
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </label>

              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                />
              </label>

              {error && <div className="relearn-auth-error">{error}</div>}

              <button type="submit" className="relearn-auth-submit" disabled={busy}>
                {busy ? "Logging in..." : "Log in"}
              </button>
            </form>

            <p className="relearn-auth-switch">
              New to Re:Learn?
              <button onClick={onSwitch}>Create an account</button>
            </p>

            <p className="relearn-auth-note">
              Sign in to access the live coding demo.
            </p>
          </div>

          <div className="relearn-auth-code-area">
            <div className="relearn-code">
              <div className="relearn-code-bar">
                <i /><i /><i />
                <span>relearn.py</span>
              </div>

              <pre>
                {lines.map((line, i) => (
                  <span key={i} className={`ln ${i === 3 ? "hot" : ""}`}>
                    {line}
                  </span>
                ))}
              </pre>
            </div>

            <div className="relearn-auth-badge">
              <span className="dot" />
              Code-first learning
            </div>

            <p>Write it. Run it. Understand it.</p>
          </div>
        </div>
      </div>
    </>
  );
}
