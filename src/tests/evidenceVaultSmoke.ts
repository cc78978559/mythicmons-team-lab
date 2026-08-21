import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {auditEvidenceVault, createEvidenceVaultSnapshot, gcEvidenceVault, quarantineEvidenceVaultSnapshot, quickEvidenceVaultStatus, restoreEvidenceVaultSnapshot} from "../draft/evidenceVault";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-evidence-vault-")), sourceA = path.join(root, "source-a"), sourceB = path.join(root, "source-b"), vault = path.join(root, "durable-vault"), restore = path.join(root, "restore"), repository = {root, remote: "https://example.test/mythicmons.git", commit: "a".repeat(40), branch: "main", dirty: false, status: []};
try {
  fs.mkdirSync(path.join(sourceA, "nested"), {recursive: true}); fs.mkdirSync(sourceB); fs.writeFileSync(path.join(sourceA, "summary.json"), "shared"); fs.writeFileSync(path.join(sourceA, "nested", "battle.bin"), "battle"); fs.writeFileSync(path.join(sourceB, "freeze.json"), "shared");
  assert.throws(() => createEvidenceVaultSnapshot({vaultRoot: path.join(sourceA, "vault"), sources: [{name: "a", path: sourceA}], label: "unsafe", repository}), /outside every source/);
  const snapshot = createEvidenceVaultSnapshot({vaultRoot: vault, sources: [{name: "stage4", path: sourceA}, {name: "stage5", path: sourceB}], label: "smoke", mode: "full", repository});
  assert.equal(snapshot.manifest.totals.files, 3); assert.equal(snapshot.manifest.totals.uniqueObjects, 2); assert.equal(snapshot.reusedObjects, 1);
  const diagnostic = createEvidenceVaultSnapshot({vaultRoot: vault, sources: [{name: "stage4", path: sourceA}], label: "dirty", mode: "full", repository: {...repository, dirty: true, status: [" M src/example.ts"]}}); assert.equal(diagnostic.manifest.evidenceLevel, "diagnostic-only");
  assert.equal(quickEvidenceVaultStatus(vault, [path.join(sourceA, "summary.json")], {requiredEvidenceLevel: "replayable"}).coveringSnapshot, snapshot.id);
  quarantineEvidenceVaultSnapshot(vault, diagnostic.id, "smoke quarantine"); assert.throws(() => quarantineEvidenceVaultSnapshot(vault, diagnostic.id, "overwrite"), /already quarantined/); assert.throws(() => restoreEvidenceVaultSnapshot({vaultRoot: vault, snapshotId: diagnostic.id, destination: path.join(root, "quarantined-restore")}), /quarantined/);
  assert.throws(() => quarantineEvidenceVaultSnapshot(vault, "snapshot-../../outside", "unsafe"), /invalid or missing/);
  const audit = auditEvidenceVault(vault, {deep: true}); assert.equal(audit.healthy, true); assert.equal(audit.snapshots, 1); assert.equal(audit.referencedObjects, 2);
  const quick = quickEvidenceVaultStatus(vault, [path.join(sourceA, "summary.json"), path.join(sourceB, "freeze.json")]); assert.equal(quick.healthy, true); assert.equal(quick.coversCurrentFiles, true); assert.equal(quick.coveringSnapshot, snapshot.id);
  fs.writeFileSync(path.join(sourceA, "summary.json"), "changed"); assert.equal(quickEvidenceVaultStatus(vault, [path.join(sourceA, "summary.json")]).coversCurrentFiles, false);
  const restored = restoreEvidenceVaultSnapshot({vaultRoot: vault, snapshotId: snapshot.id, destination: restore}); assert.equal(restored.files, 3); assert.equal(fs.readFileSync(path.join(restore, "stage4", "nested", "battle.bin"), "utf8"), "battle");
  const orphanHash = "f".repeat(64), orphan = path.join(vault, "objects", "ff", orphanHash); fs.mkdirSync(path.dirname(orphan), {recursive: true}); fs.writeFileSync(orphan, "orphan"); fs.utimesSync(orphan, new Date(0), new Date(0));
  const dry = gcEvidenceVault(vault, {apply: false, graceDays: 0}); assert.deepEqual(dry.candidates, [orphan]); assert.equal(fs.existsSync(orphan), true);
  const applied = gcEvidenceVault(vault, {apply: true, graceDays: 0}); assert.equal(applied.reclaimedBytes, 6); assert.equal(fs.existsSync(orphan), false); assert.equal(auditEvidenceVault(vault, {deep: true}).healthy, true);
  console.log("Evidence vault smoke passed: external content-addressed snapshots deduplicate, verify, restore, cover current signatures, and GC only unreferenced objects");
} finally { fs.rmSync(root, {recursive: true, force: true}); }
