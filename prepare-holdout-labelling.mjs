#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadTargetEvidence } from "./assess-labelled-corpus.mjs";
import { registrableDomain } from "./lib/publisher-ownership.mjs";
import { validateWebFixtureDocument } from "./lib/web-stress-fixture.mjs";

// Splits the locked LLM-review holdout into labelling packets for the operator-run
// labelling agent (PROCESS.md step 3.3). Each packet carries the same venue record the
// reviewer receives, plus the exact candidate URL and registrable domain the
// adjudication must reference. Nothing here reads reviewer output.

export function labellingPackets(fixture, identities, options = {}) {
  validateWebFixtureDocument(fixture);
  const size = options.batchSize || 48;
  const packets = [];
  for (let start = 0; start < fixture.entries.length; start += size) {
    const slice = fixture.entries.slice(start, start + size);
    const range = `${pad(start + 1)}-${pad(start + slice.length)}`;
    packets.push({
      schema_version: 1,
      packet: `llm-review-holdout-v1-${range}`,
      output_file: `locked-holdout-adjudication-${range}.json`,
      instructions: "LABELLING-INSTRUCTIONS.md",
      adjudication_header: {
        schema_version: 1,
        adjudication_set: `llm-review-holdout-v1-adjudication-${range}`,
        partition: "locked_holdout",
        source: "independent_fixture_review",
        selection_fingerprint_sha256: fixture.selection_fingerprint_sha256,
      },
      venues: slice.map((entry, index) => {
        const identity = identities.get(entry.venue_id) || {};
        const url = entry.candidates[0]?.url || null;
        return {
          index: start + index + 1,
          venue_id: entry.venue_id,
          name: identity.name || entry.name,
          aliases: identity.aliases || [],
          address: identity.address || entry.address || "",
          postcode: identity.postcode || "",
          municipality: identity.municipality || entry.municipality,
          region_code: identity.region || entry.region || "",
          phone: identity.phone || "",
          candidate_url: url,
          candidate_registrable_domain: url ? registrableDomain(url) : null,
        };
      }),
    });
  }
  return packets;
}

function pad(value) { return String(value).padStart(3, "0"); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function parseArgs(argv) {
  const result = { batchSize: 48 };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--fixture") result.fixture = argv[++index];
    else if (flag === "--db") result.db = argv[++index];
    else if (flag === "--output-dir") result.outputDir = argv[++index];
    else if (flag === "--batch-size") result.batchSize = Number(argv[++index]);
    else throw new Error(`unknown argument: ${flag}`);
  }
  for (const key of ["fixture", "db", "outputDir"]) {
    if (!result[key]) throw new Error(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
  }
  if (!Number.isInteger(result.batchSize) || result.batchSize < 1) throw new Error("invalid --batch-size");
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = parseArgs(process.argv.slice(2));
  const fixtureBytes = readFileSync(resolve(args.fixture));
  const fixture = JSON.parse(fixtureBytes);
  const packets = labellingPackets(fixture, loadTargetEvidence(resolve(args.db), fixture.entries),
    { batchSize: args.batchSize });
  const outputDir = resolve(args.outputDir);
  mkdirSync(outputDir, { recursive: true });
  const written = packets.map((packet) => {
    const name = `packet-${packet.packet.slice(-7)}.json`;
    const bytes = `${JSON.stringify(packet, null, 2)}\n`;
    writeFileSync(join(outputDir, name), bytes);
    return { file: name, output_file: packet.output_file, venues: packet.venues.length, sha256: sha256(bytes) };
  });
  writeFileSync(join(outputDir, "packets-manifest.json"), `${JSON.stringify({
    fixture: relative(process.cwd(), resolve(args.fixture)), fixture_sha256: sha256(fixtureBytes),
    selection_fingerprint_sha256: fixture.selection_fingerprint_sha256,
    venues: fixture.entries.length, batch_size: args.batchSize, packets: written,
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output_dir: relative(process.cwd(), outputDir),
    fixture: basename(args.fixture), packets: written.length,
    missing_phone: packets.flatMap((packet) => packet.venues).filter((venue) => !venue.phone).length,
    missing_address: packets.flatMap((packet) => packet.venues).filter((venue) => !venue.address).length,
  }, null, 2)}\n`);
}
