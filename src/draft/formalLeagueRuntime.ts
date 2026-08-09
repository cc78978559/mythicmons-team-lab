import fs from "node:fs";
import path from "node:path";
import {DRAFT_GENERATIONS} from "./customRegistry";
import {validateRegistryDirectory} from "./registrySnapshot";
import {compileSandboxTeam} from "../sandbox/compiler";
import type {CompiledSandbox, SandboxTeam} from "../sandbox/types";

export function compileBoundFormalLeagueRuntime(registryRoot: string, expectedRegistryHash: string): CompiledSandbox {
  const root = path.resolve(registryRoot), snapshot = validateRegistryDirectory(root);
  if (snapshot.hash !== expectedRegistryHash || snapshot.namespace !== expectedRegistryHash.slice(0, 12)) throw new Error("Formal registry runtime differs from the signed freeze");
  const documents = DRAFT_GENERATIONS.map(generation => JSON.parse(fs.readFileSync(path.join(root, `${generation}-six-team.json`), "utf8")) as SandboxTeam);
  return compileSandboxTeam({name: "Formal validation registry runtime", members: documents.flatMap(value => value.members), customMoves: documents.flatMap(value => value.customMoves ?? []), customAbilities: documents.flatMap(value => value.customAbilities ?? []), customItems: documents.flatMap(value => value.customItems ?? [])}, {namespace: snapshot.namespace});
}
