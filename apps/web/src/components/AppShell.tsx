"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

interface SessionData { user: { email: string; fullName: string }; organization: { name: string; role: string } }

export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<SessionData | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/v1/auth/me", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("unauthenticated");
        return response.json() as Promise<SessionData>;
      })
      .then((data) => { if (active) setSession(data); })
      .catch(() => { if (active) router.replace("/login"); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [router]);

  async function signOut() {
    await fetch("/v1/auth/logout", { method: "POST", credentials: "include" });
    router.replace("/login");
    router.refresh();
  }

  if (checking || !session) {
    return <main className="loading-screen"><span className="loading-mark">C</span><p>Opening your workspace…</p></main>;
  }

  const nav = [
    { href: "/app", label: "Overview", icon: "◫" },
    { href: "/app/inventory", label: "Inventory", icon: "▦" },
    { href: "/app/costs", label: "Cost explorer", icon: "$" },
    { href: "/app/savings", label: "Savings findings", icon: "↘" },
    { href: "/app/settings", label: "Settings", icon: "⚙" },
    { href: "/app/accounts", label: "Cloud accounts", icon: "⌘" },
  ];

  return (
    <div className="workspace">
      <aside className="sidebar">
        <a className="brand workspace-brand" href="/app"><span className="brand-mark">C</span><span>CloudRoute</span></a>
        <p className="nav-caption">WORKSPACE</p>
        <nav className="side-nav" aria-label="Main navigation">
          {nav.map((item) => <a key={item.href} className={pathname === item.href ? "side-link active" : "side-link"} href={item.href}><span className="nav-icon">{item.icon}</span>{item.label}</a>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-identity"><span className="avatar">{session.organization.name.slice(0, 1).toUpperCase()}</span><span className="identity-copy"><strong>{session.organization.name}</strong><small>{session.user.email}</small></span></div>
          <button className="signout-button" onClick={signOut}>Sign out <span aria-hidden="true">↗</span></button>
          <p className="sidebar-safety"><span /> Read-only by design</p>
        </div>
      </aside>
      <main className="workspace-main">{children}</main>
    </div>
  );
}
