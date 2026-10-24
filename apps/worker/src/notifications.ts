import { getPool, withOrgTransaction } from "@cloudroute/db";

function isoWeekKey(date = new Date()): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((day.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return day.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
}

export async function queueWeeklyDigestsOnce(now = new Date()): Promise<number> {
  if (now.getUTCDay() !== 1) return 0;
  const weekKey = isoWeekKey(now);
  const organizations = await getPool().query<{ id: string }>("SELECT id FROM organizations ORDER BY created_at ASC");
  let queued = 0;
  for (const organization of organizations.rows) {
    const count = await withOrgTransaction(organization.id, async (client) => {
      const owner = await client.query<{ email: string }>(
        "SELECT u.email FROM organizations o JOIN users u ON u.id=o.created_by WHERE o.id=$1",
        [organization.id],
      );
      if (!owner.rows[0]) return 0;
      const preference = await client.query<{ weekly_digest_enabled: boolean }>(
        "SELECT weekly_digest_enabled FROM notification_preferences WHERE org_id=$1",
        [organization.id],
      );
      if (preference.rows[0]?.weekly_digest_enabled === false) return 0;
      const [cost, findings, errors] = await Promise.all([
        client.query("SELECT currency,SUM(amount)::text AS amount FROM cost_records WHERE org_id=$1 AND period_start >= date_trunc('month',CURRENT_DATE)::date GROUP BY currency ORDER BY currency", [organization.id]),
        client.query("SELECT title,severity,provider,estimated_monthly_saving,currency FROM findings f JOIN cloud_accounts a ON a.id=f.cloud_account_id AND a.org_id=f.org_id WHERE f.org_id=$1 AND f.status='open' ORDER BY CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,f.created_at DESC LIMIT 5", [organization.id]),
        client.query("SELECT display_name,provider,last_error_code,last_sync_status FROM cloud_accounts WHERE org_id=$1 AND disconnected_at IS NULL AND status='error' ORDER BY updated_at DESC LIMIT 10", [organization.id]),
      ]);
      const payload = { weekKey, monthToDateSpend: cost.rows, topFindings: findings.rows, connectionErrors: errors.rows };
      const result = await client.query(
        "INSERT INTO email_outbox(org_id,recipient,template_key,dedupe_key,payload) VALUES ($1,$2,'weekly_digest',$3,$4::jsonb) ON CONFLICT (org_id,dedupe_key) DO NOTHING RETURNING id",
        [organization.id, owner.rows[0].email, "weekly_digest:" + weekKey, JSON.stringify(payload)],
      );
      return result.rowCount ?? 0;
    });
    queued += count;
  }
  return queued;
}

export async function queueConnectionFailure(orgId: string, accountId: string, errorCode: string): Promise<void> {
  await withOrgTransaction(orgId, async (client) => {
    const owner = await client.query<{ email: string }>(
      "SELECT u.email FROM organizations o JOIN users u ON u.id=o.created_by WHERE o.id=$1",
      [orgId],
    );
    if (!owner.rows[0]) return;
    const preference = await client.query<{ connection_failure_enabled: boolean }>(
      "SELECT connection_failure_enabled FROM notification_preferences WHERE org_id=$1",
      [orgId],
    );
    if (preference.rows[0]?.connection_failure_enabled === false) return;
    const account = await client.query<{ display_name: string; provider: string }>(
      "SELECT display_name,provider FROM cloud_accounts WHERE id=$1 AND org_id=$2",
      [accountId, orgId],
    );
    if (!account.rows[0]) return;
    const dedupe = "connection_failure:" + accountId + ":" + errorCode + ":" + new Date().toISOString().slice(0, 13);
    await client.query(
      "INSERT INTO email_outbox(org_id,recipient,template_key,dedupe_key,payload) VALUES ($1,$2,'connection_failure',$3,$4::jsonb) ON CONFLICT (org_id,dedupe_key) DO NOTHING",
      [orgId, owner.rows[0].email, dedupe, JSON.stringify({ accountName: account.rows[0].display_name, provider: account.rows[0].provider, errorCode })],
    );
  });
}

function emailText(template: string, payload: Record<string, unknown>): { subject: string; text: string } {
  if (template === "connection_failure") {
    return {
      subject: "CloudRoute connection needs attention",
      text: "A read-only cloud connection needs attention.\n\nAccount: " + String(payload.accountName ?? "Cloud account") +
        "\nProvider: " + String(payload.provider ?? "unknown").toUpperCase() + "\nError code: " + String(payload.errorCode ?? "CONNECTION_FAILED") +
        "\n\nOpen CloudRoute to review the account and its permissions. No resources were changed.",
    };
  }
  const costs = Array.isArray(payload.monthToDateSpend) ? payload.monthToDateSpend as Array<{ currency?: string; amount?: string }> : [];
  const findings = Array.isArray(payload.topFindings) ? payload.topFindings as Array<{ title?: string; severity?: string }> : [];
  const errors = Array.isArray(payload.connectionErrors) ? payload.connectionErrors as Array<{ display_name?: string; provider?: string; last_error_code?: string }> : [];
  const costText = costs.length ? costs.map((item) => String(item.currency ?? "Currency") + " " + String(item.amount ?? "0")).join("\n") : "No cost records available.";
  const findingText = findings.length ? findings.map((item, index) => (index + 1) + ". [" + String(item.severity ?? "info") + "] " + String(item.title ?? "Finding")).join("\n") : "No open savings findings.";
  const errorText = errors.length ? errors.map((item) => String(item.display_name ?? "Cloud account") + " (" + String(item.provider ?? "").toUpperCase() + "): " + String(item.last_error_code ?? "connection error")).join("\n") : "No accounts currently marked as errors.";
  return {
    subject: "Your CloudRoute weekly cloud digest",
    text: "Weekly cloud digest for " + String(payload.weekKey ?? "this week") + "\n\nMonth-to-date spend (as reported):\n" + costText +
      "\n\nTop savings findings:\n" + findingText + "\n\nConnection errors:\n" + errorText +
      "\n\nAmounts retain provider currencies. Findings are recommendations only; CloudRoute never changes cloud resources.",
  };
}

export async function deliverQueuedEmailsOnce(): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATION_FROM_EMAIL;
  if (!apiKey || !from) return false;
  const organizations = await getPool().query<{ id: string }>("SELECT id FROM organizations ORDER BY created_at ASC");
  for (const organization of organizations.rows) {
    const claim = await withOrgTransaction(organization.id, (client) => client.query<{
      id: string; recipient: string; template_key: string; payload: Record<string, unknown>; attempts: number;
    }>(
      "SELECT id,recipient,template_key,payload,attempts FROM email_outbox WHERE status IN ('queued','failed') AND next_attempt_at <= now() ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED",
    ));
    const item = claim.rows[0];
    if (!item) continue;
    await withOrgTransaction(organization.id, (client) => client.query(
      "UPDATE email_outbox SET status='sending',attempts=attempts+1 WHERE id=$1 AND org_id=$2",
      [item.id, organization.id],
    ));
    try {
      const message = emailText(item.template_key, item.payload);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: "Bearer " + apiKey, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [item.recipient], subject: message.subject, text: message.text }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(response.status === 429 ? "EMAIL_RATE_LIMITED" : "EMAIL_PROVIDER_REJECTED");
      await withOrgTransaction(organization.id, (client) => client.query(
        "UPDATE email_outbox SET status='sent',sent_at=now(),last_error_code=NULL WHERE id=$1 AND org_id=$2",
        [item.id, organization.id],
      ));
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_:-]{1,80}$/.test(error.message) ? error.message : "EMAIL_DELIVERY_FAILED";
      const retryMinutes = Math.min(360, 5 * Math.pow(2, Math.min(item.attempts, 6)));
      await withOrgTransaction(organization.id, (client) => client.query(
        "UPDATE email_outbox SET status='failed',last_error_code=$3,next_attempt_at=now()+($4::int * interval '1 minute') WHERE id=$1 AND org_id=$2",
        [item.id, organization.id, code, retryMinutes],
      ));
    }
    return true;
  }
  return false;
}
