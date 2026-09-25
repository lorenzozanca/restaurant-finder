import { existsSync, statSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { readMapSnapshot, snapshotPathFor, storeStamp } from "./map-snapshot.mjs";
import { LeadIndex } from "./national-leads.mjs";

// Keeps the lead index in step with the national store. A missing or stale
// snapshot is rebuilt in a worker thread while the previous index (if any) keeps
// answering; a new snapshot file is picked up on the next request.

const CHECK_INTERVAL_MS = 10_000;

export class NationalMapService {
  constructor(databasePath, options = {}) {
    this.databasePath = databasePath;
    this.snapshotPath = options.snapshotPath || snapshotPathFor(databasePath);
    this.checkIntervalMs = options.checkIntervalMs ?? CHECK_INTERVAL_MS;
    this.index = null;
    this.loadedMtime = 0;
    this.building = null;
    this.lastError = "";
    this.lastCheck = 0;
    // Store stamp seen when the last build finished; a build must not trigger
    // another one merely because opening the store touched its files.
    this.stampAfterBuild = 0;
    this.rebuildAgain = false;
  }

  // Returns the current index (possibly stale while a rebuild runs) or null.
  current() {
    const now = Date.now();
    if (now - this.lastCheck >= this.checkIntervalMs || !this.index) {
      this.lastCheck = now;
      this.refresh();
    }
    return this.index;
  }

  state() {
    return { ready: Boolean(this.index), building: Boolean(this.building), error: this.lastError };
  }

  refresh() {
    if (!existsSync(this.databasePath)) {
      this.lastError = "national store not found";
      return;
    }
    if (existsSync(this.snapshotPath)) {
      const mtime = statSync(this.snapshotPath).mtimeMs;
      if (mtime !== this.loadedMtime) {
        try {
          this.index = new LeadIndex(readMapSnapshot(this.snapshotPath));
          this.loadedMtime = mtime;
          this.lastError = "";
        } catch (error) {
          this.lastError = `snapshot unreadable: ${error.message}`;
        }
      }
    }
    const stamp = storeStamp(this.databasePath);
    const snapshotStamp = this.index?.snapshot.store_stamp ?? -1;
    if (stamp > Math.max(snapshotStamp, this.stampAfterBuild) || !existsSync(this.snapshotPath)) this.rebuild();
  }

  // Called after this process wrote to the store: rebuild now, or once more after
  // a build that is already running (it may have read the store before the write).
  storeChanged() {
    if (this.building) this.rebuildAgain = true;
    else this.rebuild();
  }

  rebuild() {
    if (this.building) return this.building;
    this.building = new Promise((resolve) => {
      const worker = new Worker(new URL("./map-snapshot-worker.mjs", import.meta.url), {
        workerData: { databasePath: this.databasePath, snapshotPath: this.snapshotPath },
      });
      const finish = (error) => {
        this.stampAfterBuild = storeStamp(this.databasePath);
        this.lastError = error ? `snapshot build failed: ${error.message}` : "";
        this.building = null;
        this.lastCheck = 0;
        resolve();
        if (this.rebuildAgain) {
          this.rebuildAgain = false;
          this.rebuild();
        }
      };
      worker.once("message", () => finish(null));
      worker.once("error", finish);
      worker.once("exit", (code) => { if (this.building && code !== 0) finish(new Error(`worker exited ${code}`)); });
    });
    return this.building;
  }
}
