#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { validateWebAdjudicationSet } from "../lib/web-stress-fixture.mjs";

const FIRST_SOURCE = resolve("benchmark/session-12-web");
const SECOND_SOURCE = resolve("benchmark/session-12-extension-web");

function load(path) { return JSON.parse(readFileSync(path, "utf8")); }
function projected(document) {
  return { ...document,
    fixture_set: document.fixture_set.replace(/-partial$/, ""),
    entries: document.entries.map((entry) => ({ ...entry,
      candidates: entry.candidates.map((candidate) => ({ ...candidate,
        title: [...candidate.title].slice(0, 200).join(""),
      })),
    })),
  };
}

function assembleCohort(source, destination) {
  mkdirSync(destination);
  const names = readdirSync(source).sort();
  const captureNames = names.filter((name) =>
    /^locked-holdout-capture-\d{3}-\d{3}\.partial\.json$/.test(name));
  const adjudicationNames = names.filter((name) =>
    /^locked-holdout-adjudication-\d{3}-\d{3}\.json$/.test(name));
  const fixtures = captureNames.map((name) => projected(load(resolve(source, name))));
  const adjudications = adjudicationNames.map((name) => load(resolve(source, name)));
  validateWebAdjudicationSet(adjudications, fixtures, { expectedPartition: "locked_holdout" });
  for (let index = 0; index < captureNames.length; index += 1) {
    const name = captureNames[index].replace(/^locked-holdout-capture-/, "locked-holdout-")
      .replace(/\.partial\.json$/, ".json");
    writeFileSync(resolve(destination, name), `${JSON.stringify(fixtures[index], null, 2)}\n`, { flag: "wx" });
  }
  for (const name of adjudicationNames) {
    cpSync(resolve(source, name), resolve(destination, basename(name)),
      { force: false, errorOnExist: true });
  }
  return { projected_fixture_files: fixtures.length, adjudication_files: adjudications.length,
    venues: fixtures.reduce((sum, document) => sum + document.entries.length, 0) };
}

function outputArgument(argv) {
  if (argv.length !== 2 || argv[0] !== "--output" || !argv[1]) {
    throw new Error("usage: node benchmark/assemble-session-12-combined-fixtures.mjs --output <new-directory>");
  }
  return resolve(argv[1]);
}

const output = outputArgument(process.argv.slice(2));
if (existsSync(output)) throw new Error(`refusing to use existing output directory: ${output}`);
mkdirSync(output);
const first = assembleCohort(FIRST_SOURCE, resolve(output, "cohort-1"));
const second = assembleCohort(SECOND_SOURCE, resolve(output, "cohort-2"));
process.stdout.write(`${JSON.stringify({ output, cohort_1: first, cohort_2: second }, null, 2)}\n`);
