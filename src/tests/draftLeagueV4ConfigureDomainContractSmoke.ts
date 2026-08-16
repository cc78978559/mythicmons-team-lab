import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), "src", "cli", "draftLeagueV4.ts");
const source = fs.readFileSync(file, "utf8");
const declaration = "function learnConfigurationPreferences(";
const start = source.indexOf(declaration);

assert.notEqual(start, -1, "learnConfigurationPreferences is missing");
assert.equal(source.indexOf(declaration, start + declaration.length), -1, "learnConfigurationPreferences is duplicated");

const bodyStart = source.indexOf("{", start);
assert.notEqual(bodyStart, -1, "learnConfigurationPreferences has no body");
let depth = 0, bodyEnd = -1;
for (let index = bodyStart; index < source.length; index += 1) {
  if (source[index] === "{") depth += 1;
  else if (source[index] === "}") {
    depth -= 1;
    if (depth === 0) {
      bodyEnd = index + 1;
      break;
    }
  }
}
assert.notEqual(bodyEnd, -1, "learnConfigurationPreferences body is unbalanced");

const body = source.slice(bodyStart, bodyEnd);
assert.match(body, /ledger\.add\(\{stage: "review", domain: "configure", actor: career\.id, decision: `第\$\{season\}季配置证据更新`/);
assert.doesNotMatch(body, /ledger\.add\(\{stage: "review", domain: "research"/);
console.log("draft league V4 configure domain contract smoke passed");
