import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {compactWhiteBoxRun} from "../ai/whiteBox/retention";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "whitebox-retention-"));
try {
  fs.mkdirSync(path.join(root, "season-01", "battles"), {recursive: true});
  fs.mkdirSync(path.join(root, "season-01", "rosters"), {recursive: true});
  fs.mkdirSync(path.join(root, "career-decisions"), {recursive: true});
  fs.mkdirSync(path.join(root, "config-snapshots", "registry"), {recursive: true});
  fs.writeFileSync(path.join(root, "dynasty-state.json"), "{}\n");
  fs.writeFileSync(path.join(root, "season-01", "season.json"), "{}\n");
  fs.writeFileSync(path.join(root, "season-01", "decision-ledger.json"), "{}\n");
  fs.writeFileSync(path.join(root, "season-01", "battles", "public.log"), "battle evidence");
  fs.writeFileSync(path.join(root, "season-01", "rosters", "manager.json"), "roster evidence");
  fs.writeFileSync(path.join(root, "career-decisions", "manager.json"), "career evidence");
  fs.writeFileSync(path.join(root, "config-snapshots", "registry", "registry-manifest.json"), "replay evidence");
  const trace = compactWhiteBoxRun(root);
  assert(trace.removedBytes > 0);assert.equal(trace.removedPaths.length, 3);
  assert(fs.existsSync(path.join(root, "dynasty-state.json")));assert(fs.existsSync(path.join(root, "season-01", "decision-ledger.json")));
  assert(fs.existsSync(path.join(root, "config-snapshots", "registry", "registry-manifest.json")), "Registry snapshots are replay evidence and must survive compaction");
  assert(!fs.existsSync(path.join(root, "season-01", "battles")));assert(!fs.existsSync(path.join(root, "career-decisions")));
  assert.throws(()=>compactWhiteBoxRun(path.join(root,"missing")),/without dynasty-state/);
} finally {fs.rmSync(root,{recursive:true,force:true});}
console.log("White-box terminal retention smoke test passed");
