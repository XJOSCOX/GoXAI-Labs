import type React from "react";
import goxaiLogo from "../../assets/goxailab-logo.png";
import { ThemeToggle } from "../layout/ThemeToggle";

export function AuthFrame({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <div className="utility-row">
          <ThemeToggle />
        </div>
        <div className="brand-row">
          <img className="auth-brand-logo" src={goxaiLogo} alt="" />
          <div>
            <p className="eyebrow">GoXAi Lab</p>
            <h1>{title}</h1>
          </div>
        </div>
        <p className="auth-copy">{subtitle}</p>
        {children}
      </section>
      <aside className="auth-aside">
        <div className="auth-visual-copy">
          <p className="eyebrow">Studio operations</p>
          <h2>Organize identity, data, and review work from one calm workspace.</h2>
          <div className="auth-visual-metrics" aria-label="Platform foundations">
            <span>Supabase Auth</span>
            <span>Prisma Postgres</span>
            <span>R2 assets</span>
          </div>
        </div>
      </aside>
    </main>
  );
}
