#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EnrichmentQueue } from "./lib/enrichment-queue.mjs";

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function runQueueCommand(argv = process.argv.slice(2), env = process.env) {
  if (!argv[0] || argv[0] === "--help" || argv[0] === "-h") return usage();
  const command = argv[0];
  const args = parseArgs(argv.slice(1));
  if (args.help) return usage();
  const database = args.db || env.EVIDENCE_DB_PATH;
  if (!database) throw new Error("--db or EVIDENCE_DB_PATH is required");
  const queue = new EnrichmentQueue(resolve(database));
  try {
    if (command === "status") return queue.status();
    if (command === "jobs") {
      const status = args.status ? String(args.status) : "";
      return queue.db.prepare(`SELECT job_id, idempotency_key, venue_id, run_id, stage, priority,
        status, provider, domain, attempt_count, max_attempts, next_attempt_at, lease_owner,
        lease_expires_at, cancel_requested, cancel_reason, last_error, created_at, updated_at, finished_at
        FROM enrichment_jobs WHERE (? = '' OR status = ?) ORDER BY priority DESC, job_id`)
        .all(status, status);
    }
    if (command === "recover") return { recovered: queue.recoverExpired() };
    if (command === "cancel") {
      const jobId = jobIdentifier(args, "cancel");
      const job = queue.cancel(jobId, args.reason || "operator_cancelled");
      if (!job) throw new Error(`job ${jobId} not found`);
      return job;
    }
    if (command === "retry") return queue.retry(jobIdentifier(args, "retry"));
    if (command === "resume-quota") {
      const scope = String(args.scope || "provider");
      const key = String(args.key || args.provider || "");
      if (!key) throw new Error("resume-quota requires --key KEY or --provider PROVIDER");
      const resumed = queue.resumeQuota(scope, key);
      if (!resumed) throw new Error(`no quota pause found for ${scope}:${key}`);
      return resumed;
    }
    if (command === "ownership-list") {
      return queue.store.listPublisherAttestations({ venueId: args.venue, limit: args.limit });
    }
    if (command === "ownership-unattested") {
      return queue.store.listUnattestedCandidates({ limit: args.limit });
    }
    if (command === "ownership-import") {
      if (!args.selection) throw new Error("ownership-import requires --selection PATH");
      const selectionBytes = await readFile(resolve(String(args.selection)));
      const selection = JSON.parse(selectionBytes);
      return queue.store.importPublisherReviews(selection, {
        selectionFingerprint: args.fingerprint
          || createHash("sha256").update(selectionBytes).digest("hex"),
        expiresAt: args.expiresAt,
      });
    }
    if (["ownership-approve", "ownership-reject"].includes(command)) {
      for (const required of ["venue", "website", "evidence", "reviewer", "reviewedAt", "expiresAt"]) {
        if (!args[required]) throw new Error(`${command} requires --${required.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
      }
      return queue.store.recordPublisherAttestation(String(args.venue), {
        status: command === "ownership-approve" ? "verified" : "rejected",
        method: args.method || "manual_first_party_review",
        venue_id: String(args.venue), website_url: String(args.website),
        evidence_urls: String(args.evidence).split(",").map((item) => item.trim()).filter(Boolean),
        reviewer: String(args.reviewer), reviewed_at: String(args.reviewedAt),
        expires_at: String(args.expiresAt), notes: args.notes,
        source_kind: "human_review", source_fingerprint: args.fingerprint,
      }, { reason: args.reason || "operator_publisher_review" });
    }
    if (command === "ownership-revoke") {
      for (const required of ["venue", "domain", "reviewer", "reason"]) {
        if (!args[required]) throw new Error(`ownership-revoke requires --${required}`);
      }
      return queue.store.revokePublisherAttestation(String(args.venue), String(args.domain), {
        reviewer: String(args.reviewer), reason: String(args.reason), occurredAt: args.occurredAt,
      });
    }
    if (command === "ownership-history") {
      if (!args.venue) throw new Error("ownership-history requires --venue VENUE_ID");
      return queue.store.publisherAttestationHistory(String(args.venue), String(args.domain || ""));
    }
    if (command === "export") {
      if (!args.output) throw new Error("export requires --output PATH");
      const output = resolve(String(args.output));
      const document = queue.exportLegacyScan({ municipality: args.municipality || "" });
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, "utf8");
      return { output, restaurants: document.total, with_resources: document.with_resources };
    }
    throw new Error(`unknown queue command: ${command}`);
  } finally {
    queue.close();
  }
}

function parseArgs(argv) {
  const parsed = { positional: [] };
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === "--help" || item === "-h") { parsed.help = true; continue; }
    if (!item.startsWith("--")) { parsed.positional.push(item); continue; }
    const [rawKey, inline] = item.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    if (inline !== undefined) parsed[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) parsed[key] = argv[++index];
    else parsed[key] = true;
  }
  return parsed;
}

function jobIdentifier(args, command) {
  const raw = args.positional[0] || args.job;
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw new Error(`${command} requires a positive job ID`);
  return id;
}

function usage() {
  return `Usage: node queue-ops.mjs <command> --db PATH [options]

Commands:
  status                         Show queue counts and ready work
  jobs [--status STATUS]         List jobs, optionally filtered
  recover                        Recover expired worker leases
  cancel JOB_ID [--reason TEXT]  Cancel queued work or request leased cancellation
  retry JOB_ID                   Requeue a cancelled or dead-letter job
  resume-quota --provider NAME   Resume jobs after confirming provider quota
               [--scope SCOPE] [--key KEY]
  ownership-list [--venue ID]    List durable publisher attestations
  ownership-unattested           List venues without an active attestation
  ownership-import --selection   Import accepted reviews idempotently
  ownership-approve              Record a verified ownership decision
  ownership-reject               Record a rejected ownership decision
  ownership-revoke               Revoke an attestation with an audit reason
  ownership-history --venue ID   Show publisher-attestation audit history
  export --output PATH           Export active accepted evidence for the existing UI
         [--municipality NAME]

EVIDENCE_DB_PATH may be used instead of --db.`;
}

if (isMain) {
  try {
    const result = await runQueueCommand();
    console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`queue-ops: ${error.message}`);
    process.exitCode = 1;
  }
}
