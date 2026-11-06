import { z } from "zod";
import { sql } from "@aihot/backend/db";
import { completeReceipt } from "@aihot/backend/providers/receipts";
import { listedEvidence } from "@aihot/backend/publication/evidence";

const evidence = z.object({
  id: z.string(), title: z.string(), source: z.string(), url: z.httpUrl(),
  publishedAt: z.iso.datetime({ offset: true }), revision: z.string().regex(/^[a-f0-9]{64}$/),
});
const term = z.object({
  key: z.string().min(1), term: z.string().min(1), kind: z.enum(["model", "product", "tool", "repository", "concept", "other"]),
  summary: z.string(), opportunity: z.string().nullable(), firstSeen: z.iso.date(), lastSeen: z.iso.date(),
  sourceCount: z.int().positive(), evidenceCount: z.int().positive(), evidence: z.array(evidence).min(1).max(20),
  review: z.object({ dueOn: z.iso.date(), status: z.enum(["pending", "follow_up", "no_follow_up", "insufficient_data"]) }),
  trend: z.array(z.object({ day: z.iso.date(), count: z.int().nonnegative().nullable() })).length(14),
  score: z.int().min(0).max(100),
});
export const snapshot = z.object({
  version: z.literal(1), observedAt: z.iso.datetime({ offset: true }), terms: z.array(term).max(50),
});

export async function saveSnapshot(report: z.infer<typeof snapshot>, receiptIds: number[] = []) {
  const date = new Date(report.observedAt);
  await sql.begin(async tx => {
    await tx`INSERT INTO term_radar_snapshots (day, observed_at, terms)
      VALUES (${date.toISOString().slice(0, 10)}, ${date}, ${sql.json(report.terms)})
      ON CONFLICT (day) DO UPDATE SET observed_at = EXCLUDED.observed_at, terms = EXCLUDED.terms
      WHERE term_radar_snapshots.observed_at <= EXCLUDED.observed_at`;
    for (const id of receiptIds) await completeReceipt(tx, id);
  });
}

export async function latestReport(now = new Date()) {
  const [row] = await sql<{ observed_at: Date; terms: z.infer<typeof term>[] }[]>`
    SELECT observed_at, terms FROM term_radar_snapshots WHERE day <= ${now.toISOString().slice(0, 10)}
    AND observed_at <= ${now} ORDER BY day DESC LIMIT 1`;
  const terms = row?.terms ?? [];
  const ids = [...new Set(terms.flatMap(t => t.evidence.map(e => e.id)))];
  const current = new Map((await listedEvidence(now, { ids })).map(e => [e.id, e]));
  // Withdrawals and editorial corrections apply immediately, including to text inferred from old evidence.
  const visible = terms.filter(t => t.evidence.every(e => current.get(e.id)?.revision === e.revision));
  return { version: 1, observedAt: row?.observed_at.toISOString() ?? null, terms: visible.map(t => ({
    ...t, evidence: t.evidence.map(({ id }) => {
      const { title, source, url, publishedAt } = current.get(id)!;
      return { id, title, source, url, publishedAt };
    }),
  })) };
}
