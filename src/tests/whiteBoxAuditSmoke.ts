import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {auditWhiteBoxOutput, auditWhiteBoxRecords, whiteBoxAuditMarkdown} from "../ai/whiteBox/audit";
import {evaluateWhiteBoxBid} from "../ai/whiteBox/auction";

const trace = evaluateWhiteBoxBid({decisionId: "audit:bid", managerId: "manager-01", candidateId: "asset-01", mode: "standard", budget: 100, reserve: 5, market: 20, fit: 2, fundamental: 0, starPremium: .5, bidAggression: .4, cashUtility: .5, remainingNeed: 3, scarceMultiplier: 1, shade: 4});
const record = {stage: "auction", context: {bids: [{bid: trace.bid, ceiling: trace.ceiling, whiteBox: trace}]}};
const valid = auditWhiteBoxRecords([{source: "fixture", records: [record]}]);
assert.equal(valid.fatalCount, 0);
assert.equal(valid.coverage, 1);
assert.equal(valid.promotion, "shadow-stable");
assert.match(whiteBoxAuditMarkdown(valid), /追踪覆盖：1\/1/);

const missing = auditWhiteBoxRecords([{source: "missing", records: [{stage: "auction", context: {bids: [{bid: 1, ceiling: 1}]}}]}]);
assert(missing.issues.some(issue => issue.code === "missing-bid-trace"));
assert.equal(missing.promotion, "blocked");

const corrupted = JSON.parse(JSON.stringify(record));
corrupted.context.bids[0].whiteBox.parameters["bid.shadescale"] = 5000;
corrupted.context.bids[0].whiteBox.bid += 1;
const invalid = auditWhiteBoxRecords([{source: "corrupt", records: [corrupted]}]);
assert(invalid.issues.some(issue => issue.code === "parameter-out-of-range"));
assert(invalid.issues.some(issue => issue.code === "bid-arithmetic-drift"));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-whitebox-audit-"));
try {
  fs.writeFileSync(path.join(root, "decision-ledger.json"), `${JSON.stringify({version: 1, records: [record]})}\n`, "utf8");
  const scanned = auditWhiteBoxOutput(root);
  assert.equal(scanned.files, 1);
  assert.equal(scanned.auditedTraces, 1);
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

console.log("White-box unified audit smoke test passed");
