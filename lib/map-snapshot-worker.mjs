import { parentPort, workerData } from "node:worker_threads";
import { writeMapSnapshot } from "./map-snapshot.mjs";

// Builds the map snapshot off the server's main thread (it reads every source
// record and takes several seconds).
parentPort.postMessage(writeMapSnapshot(workerData.databasePath, workerData.snapshotPath));
