import assert from "node:assert/strict";
import path from "node:path";
import {compileBoundFormalLeagueRuntime} from "../draft/formalLeagueRuntime";
import {validateRegistryDirectory} from "../draft/registrySnapshot";

const registry = path.resolve("data/draft"), snapshot = validateRegistryDirectory(registry), compiled = compileBoundFormalLeagueRuntime(registry, snapshot.hash);
assert.equal(compiled.formatId, `gen9mythicmonssandbox${snapshot.namespace}`);
assert(compiled.manifest.syntheticSpecies.includes("mythicluxrayhp8wp4"), "The bound runtime must recognize species exported by the formal league roster");
assert.throws(() => compileBoundFormalLeagueRuntime(registry, "0".repeat(64)), /differs from the signed freeze/);
console.log("formal league runtime smoke passed: registry hash, namespaced format, and roster species identity");
