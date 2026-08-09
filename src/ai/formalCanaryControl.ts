import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type FormalCanaryStatus = "no-candidate" | "adapter-required" | "execution-ready";
export const FORMAL_CANARY_ADAPTER_PROTOCOL = "manager-program-v2-battle-rule-v1" as const;
export interface FormalCanaryAdapterRegistry {
  schemaVersion: 1;
  authority: "manual-reviewed-canary-adapters";
  adapters: Array<{id: string; implementationFile: string; sha256: string; targets: string[]}>;
  sha256: string;
}
export interface FormalCanaryHandoff {
  schemaVersion: 2;
  authority: "limited-canary-handoff-no-automatic-activation";
  status: FormalCanaryStatus;
  source: {freezeSha256: string; summarySha256: string};
  domains: Array<{domainId: string; mechanismKey: string; target: string; expectedDirection: "better" | "worse"; hypotheses: Array<{managerId: string; ruleId: string}>; adapter: {status: "ready" | "required"; id: string | null; implementationSha256: string | null; reason: string}}>;
  control: {seasons: number; applicationRate: number; maximumApplicationsPerSeason: number; rollbackOn: string[]; promotion: "manual-review-required"};
  automaticActivationAllowed: false;
  sha256: string;
}

const rollbackConditions = ["artifact-binding-failure", "technical-failure", "statistically-supported-regression", "application-budget-breach"];

export function buildFormalCanaryAdapterRegistry(adapters: Array<{id: string; implementationFile: string; targets: string[]}>): FormalCanaryAdapterRegistry {
  const normalized = adapters.map(adapter => ({id: adapter.id.trim(), implementationFile: path.resolve(adapter.implementationFile), sha256: fs.existsSync(adapter.implementationFile) ? shaFile(adapter.implementationFile) : "", targets: [...new Set(adapter.targets.map(String).map(target => target.trim()).filter(Boolean))].sort()})).sort((left, right) => left.id.localeCompare(right.id));
  const core = {schemaVersion: 1 as const, authority: "manual-reviewed-canary-adapters" as const, adapters: normalized}, registry = {...core, sha256: canonicalSha(core)}; verifyFormalCanaryAdapterRegistry(registry); return registry;
}

export function buildFormalCanaryHandoff(freeze: any, summary: any, options: {seasons?: number; applicationRate?: number; maximumApplicationsPerSeason?: number; adapterRegistry?: FormalCanaryAdapterRegistry | null} = {}): FormalCanaryHandoff {
  requireSigned(freeze, "freeze"); requireSigned(summary, "summary");
  if (options.adapterRegistry) verifyFormalCanaryAdapterRegistry(options.adapterRegistry);
  if (summary.freezeSha256 !== freeze.sha256 || summary.automaticActivationAllowed !== false || !Array.isArray(summary.limitedCanaryEligibleDomains) || !Array.isArray(freeze.domains)) throw new Error("Formal canary source binding is invalid");
  const eligible = new Set(summary.limitedCanaryEligibleDomains.map(String));
  if (eligible.size > 1) throw new Error("Formal canary handoff permits exactly one decision domain at a time");
  const domains = freeze.domains.filter((domain: any) => eligible.has(String(domain.id))).map((domain: any) => {
    const protocol = String(domain.adapterProtocol ?? ""), registration = options.adapterRegistry?.adapters.find(value => value.id === protocol);
    const ready = Boolean(protocol && registration && registration.targets.includes(String(domain.target)));
    return {domainId: String(domain.id), mechanismKey: String(domain.mechanismKey), target: String(domain.target), expectedDirection: domain.expectedDirection as "better" | "worse", hypotheses: (domain.hypotheses ?? []).map((value: any) => ({managerId: String(value.managerId), ruleId: String(value.rule?.id)})).sort((a: any, b: any) => a.managerId.localeCompare(b.managerId) || a.ruleId.localeCompare(b.ruleId)), adapter: {status: ready ? "ready" as const : "required" as const, id: ready ? registration!.id : null, implementationSha256: ready ? registration!.sha256 : null, reason: ready ? "manually reviewed live adapter is registry-bound to its local implementation" : "formal mechanism lacks a reviewed, locally verified semantics-preserving live adapter"}};
  });
  if (domains.length !== eligible.size) throw new Error("Formal canary eligible domains are absent from the signed freeze");
  const status: FormalCanaryStatus = !domains.length ? "no-candidate" : domains.every((domain: FormalCanaryHandoff["domains"][number]) => domain.adapter.status === "ready") ? "execution-ready" : "adapter-required";
  const core = {schemaVersion: 2 as const, authority: "limited-canary-handoff-no-automatic-activation" as const, status, source: {freezeSha256: freeze.sha256, summarySha256: summary.sha256}, domains, control: {seasons: boundedInteger(options.seasons ?? 2, 1, 6), applicationRate: bounded(options.applicationRate ?? .1, .001, .5), maximumApplicationsPerSeason: boundedInteger(options.maximumApplicationsPerSeason ?? 12, 1, 100), rollbackOn: [...rollbackConditions], promotion: "manual-review-required" as const}, automaticActivationAllowed: false as const};
  const handoff = {...core, sha256: canonicalSha(core)}; verifyFormalCanaryHandoff(handoff); return handoff;
}

export function verifyFormalCanaryAdapterRegistry(value: FormalCanaryAdapterRegistry): void {
  const {sha256, ...core} = value;
  if (value.schemaVersion !== 1 || value.authority !== "manual-reviewed-canary-adapters" || canonicalSha(core) !== sha256 || !Array.isArray(value.adapters) || new Set(value.adapters.map(adapter => adapter.id)).size !== value.adapters.length) throw new Error("Invalid formal canary adapter registry");
  for (const adapter of value.adapters) {
    if (!nonEmpty(adapter.id) || !path.isAbsolute(adapter.implementationFile) || !hexSha(adapter.sha256) || !Array.isArray(adapter.targets) || !adapter.targets.length || adapter.targets.some(target => !nonEmpty(target)) || new Set(adapter.targets).size !== adapter.targets.length || !fs.existsSync(adapter.implementationFile) || shaFile(adapter.implementationFile) !== adapter.sha256) throw new Error(`Invalid formal canary adapter registration: ${adapter.id || "unnamed"}`);
  }
}

export function verifyFormalCanaryHandoff(value: FormalCanaryHandoff): void {
  if (!value || typeof value !== "object") throw new Error("Invalid formal canary handoff");
  const {sha256, ...core} = value, statuses: FormalCanaryStatus[] = ["no-candidate", "adapter-required", "execution-ready"];
  const basic = value.schemaVersion === 2 && value.authority === "limited-canary-handoff-no-automatic-activation" && value.automaticActivationAllowed === false && hexSha(sha256) && canonicalSha(core) === sha256 && statuses.includes(value.status) && hexSha(value.source?.freezeSha256) && hexSha(value.source?.summarySha256) && Array.isArray(value.domains) && Array.isArray(value.control?.rollbackOn);
  if (!basic) throw new Error("Invalid formal canary handoff");
  const domainIds = new Set<string>();
  for (const domain of value.domains) {
    const hypotheses = Array.isArray(domain.hypotheses) ? domain.hypotheses : [], hypothesisIds = hypotheses.map(row => `${row.managerId}\0${row.ruleId}`), adapter = domain.adapter;
    if (!nonEmpty(domain.domainId) || domainIds.has(domain.domainId) || !nonEmpty(domain.mechanismKey) || !nonEmpty(domain.target) || !["better", "worse"].includes(domain.expectedDirection) || !hypotheses.length || hypotheses.some(row => !nonEmpty(row.managerId) || !nonEmpty(row.ruleId)) || new Set(hypothesisIds).size !== hypothesisIds.length || !adapter || !["ready", "required"].includes(adapter.status) || !nonEmpty(adapter.reason)) throw new Error("Invalid formal canary handoff");
    if (adapter.status === "ready" ? !nonEmpty(adapter.id) || !hexSha(adapter.implementationSha256) : adapter.id !== null || adapter.implementationSha256 !== null) throw new Error("Invalid formal canary handoff");
    domainIds.add(domain.domainId);
  }
  const allReady = value.domains.length > 0 && value.domains.every(domain => domain.adapter.status === "ready"), expectedStatus: FormalCanaryStatus = !value.domains.length ? "no-candidate" : allReady ? "execution-ready" : "adapter-required";
  if (value.domains.length > 1 || value.status !== expectedStatus || !Number.isInteger(value.control.seasons) || value.control.seasons < 1 || value.control.seasons > 6 || !Number.isFinite(value.control.applicationRate) || value.control.applicationRate < .001 || value.control.applicationRate > .5 || !Number.isInteger(value.control.maximumApplicationsPerSeason) || value.control.maximumApplicationsPerSeason < 1 || value.control.maximumApplicationsPerSeason > 100 || value.control.promotion !== "manual-review-required" || JSON.stringify(value.control.rollbackOn) !== JSON.stringify(rollbackConditions)) throw new Error("Invalid formal canary handoff");
}

function requireSigned(value: any, label: string): void { if (!value || !hexSha(value.sha256)) throw new Error(`Unsigned formal canary ${label}`); const {sha256, ...core} = value; if (canonicalSha(core) !== sha256) throw new Error(`Formal canary ${label} signature mismatch`); }
function bounded(value: number, minimum: number, maximum: number): number { if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`Canary value must be ${minimum}..${maximum}`); return value; }
function boundedInteger(value: number, minimum: number, maximum: number): number { if (!Number.isInteger(value)) throw new Error("Canary value must be an integer"); return bounded(value, minimum, maximum); }
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function hexSha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value); }
function shaFile(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function canonicalSha(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function canonical(value: any): any { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
