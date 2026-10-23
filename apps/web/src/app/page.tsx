const capabilities = [
  {
    number: "01",
    title: "Unified inventory",
    description: "Bring supported AWS and Google Cloud resources into one searchable view.",
    status: "Planned",
  },
  {
    number: "02",
    title: "Cost visibility",
    description: "Review provider-reported costs with clear attribution and data freshness.",
    status: "Planned",
  },
  {
    number: "03",
    title: "Sync health",
    description: "See connection status and when cloud data was last successfully refreshed.",
    status: "Foundation",
  },
];

export default function HomePage() {
  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="CloudRoute home">
          <span className="brand-mark" aria-hidden="true">C</span>
          <span>CloudRoute</span>
        </a>
        <div className="landing-nav"><span className="mode-badge"><span /> Read-only by design</span><a className="landing-signin" href="/security">Security</a><a className="landing-signin" href="/login">Sign in</a><a className="landing-get-started" href="/signup">Get started <span aria-hidden="true">→</span></a></div>
      </header>

      <section className="hero">
        <p className="eyebrow">MULTI-CLOUD VISIBILITY</p>
        <h1>Your cloud landscape,<br /><span>one clear route.</span></h1>
        <p className="hero-copy">
          A calmer way to understand cloud resources, spending, and sync health
          across providers — without giving a dashboard permission to change your infrastructure.
        </p>
        <div className="hero-actions">
          <a className="primary-button" href="/signup">Create your workspace <span aria-hidden="true">→</span></a>
          <span className="build-status"><span className="status-dot" /> Foundation in progress</span>
        </div>
        <div className="notice" role="note">
          <span className="notice-icon" aria-hidden="true">i</span>
          <p><strong>No cloud accounts are connected.</strong> This page is the initial product foundation, not a live inventory or cost report. No demo figures are shown as real data.</p>
        </div>
      </section>

      <section className="capabilities" id="capabilities" aria-labelledby="capabilities-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">THE MVP FOUNDATION</p>
            <h2 id="capabilities-title">Built around clarity.</h2>
          </div>
          <p className="section-note">Useful signals first. Cloud control actions are out of scope for the MVP.</p>
        </div>
        <div className="capability-grid">
          {capabilities.map((item) => (
            <article className="capability-card" key={item.number}>
              <div className="card-topline"><span>{item.number}</span><span className={item.status === "Foundation" ? "tag tag-active" : "tag"}>{item.status}</span></div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="footer">
        <span>CloudRoute <span className="footer-muted">· MVP foundation</span></span>
        <span>Observe clearly. Act carefully.</span>
      </footer>
    </main>
  );
}
