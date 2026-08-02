import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {acquireSourceCacheLease, auditSourceCaches, gcSourceCaches, touchSourceCache} from "../draft/sourceCacheMaintenance";
import {buildStorageIndex} from "../draft/storageIndex";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-tooling-doctor-")), cache = path.join(root, "shadow-lineup-source-cache"), keyA = "a".repeat(64), keyB = "b".repeat(64);
try {
  writeCache(keyA, 700); writeCache(keyB, 700); touchSourceCache(path.join(cache, keyB), keyB, "smoke");
  const study = path.join(root, "active-study"); fs.mkdirSync(study); fs.writeFileSync(path.join(study, "causal-manifest.json"), JSON.stringify({sourceCache: {key: keyB}, items: [{status: "pending"}]}));
  const index = buildStorageIndex(root); assert.equal(index.entries.some(entry => entry.path === "shadow-lineup-source-cache"), true); assert.ok(index.bytes >= 1400);
  const audit = auditSourceCaches(cache, root, 900); assert.equal(audit.entries.length, 2); assert.ok(audit.overBudgetBytes > 0); assert.equal(audit.entries.find(entry => entry.key === keyB)?.pinnedReferences.length, 1);
  const dry = gcSourceCaches(cache, root, {budgetBytes: 900, maxAgeDays: 3650, apply: false}); assert.deepEqual(dry.removed.map(entry => entry.key), [keyA]); assert.equal(fs.existsSync(path.join(cache, keyA)), true);
  const lease = acquireSourceCacheLease(path.join(cache, keyA), keyA, "smoke");
  const leased = gcSourceCaches(cache, root, {budgetBytes: 900, maxAgeDays: 3650, apply: true}); assert.deepEqual(leased.removed, []); assert.equal(leased.audit.entries.find(entry => entry.key === keyA)?.activeLeases.length, 1); lease.release();
  const applied = gcSourceCaches(cache, root, {budgetBytes: 900, maxAgeDays: 3650, apply: true}); assert.deepEqual(applied.removed.map(entry => entry.key), [keyA]); assert.equal(fs.existsSync(path.join(cache, keyA)), false); assert.equal(fs.existsSync(path.join(cache, keyB)), true);
  console.log("Tooling doctor smoke passed: streaming index, cache budget, reference and process-lease protection, and safe GC");
} finally { fs.rmSync(root, {recursive: true, force: true}); }
function writeCache(key: string, bytes: number): void { const directory = path.join(cache, key); fs.mkdirSync(directory, {recursive: true}); fs.writeFileSync(path.join(directory, "source-cache.json"), JSON.stringify({schemaVersion: 1, key})); fs.writeFileSync(path.join(directory, "payload.bin"), Buffer.alloc(bytes)); }
