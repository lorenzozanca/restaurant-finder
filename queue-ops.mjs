#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
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
