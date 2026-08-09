import crypto from "node:crypto";

export type FormalCanaryStatus = "no-candidate" | "adapter-required" | "execution-ready";
export interface FormalCanaryHandoff {
  schemaVersion: 1;
  authority: "limited-canary-handoff-no-automatic-activation";
  status: FormalCanaryStatus;
  source: {freezeSha256: string; summarySha256: string};
  domains: Array<{domainId: string; mechanismKey: string; target: string; expectedDirection: "better" | "worse"; hypotheses: Array<{managerId: string; ruleId: string}>; adapter: {status: "ready" | "required"; id: string | null; reason: string}}>;
  control: {seasons: number; applicationRate: number; maximumApplicationsPerSeason: number; rollbackOn: string[]; promotion: "manual-review-required"};
  automaticActivationAllowed: false;
  sha256: string;
}

export function buildFormalCanaryHandoff(freeze: any, summary: any, options: {seasons?: number; applicationRate?: number; maximumApplicationsPerSeason?: number} = {}): FormalCanaryHandoff {
  requireSigned(freeze, "freeze"); requireSigned(summary, "summary");
  if (summary.freezeSha256 !== freeze.sha256 || summary.automaticActivationAllowed !== false || !Array.isArray(summary.limitedCanaryEligibleDomains) || !Array.isArray(freeze.domains)) throw new Error("Formal canary source binding is invalid");
  const eligible = new Set(summary.limitedCanaryEligibleDomains.map(String));
  const domains = freeze.domains.filter((domain: any) => eligible.has(String(domain.id))).map((domain: any) => {
    const adapter = domain.canaryAdapter;
    const ready = adapter?.id === "battle-manager-program-v1" && /^[a-f0-9]{64}$/i.test(String(adapter?.sha256 ?? ""));
    return {domainId: String(domain.id), mechanismKey: String(domain.mechanismKey), target: String(domain.target), expectedDirection: domain.expectedDirection as "better" | "worse", hypotheses: (domain.hypotheses ?? []).map((value: any) => ({managerId: String(value.managerId), ruleId: String(value.rule?.id)})).sort((a: any, b: any) => a.managerId.localeCompare(b.managerId) || a.ruleId.localeCompare(b.ruleId)), adapter: {status: ready ? "ready" as const : "required" as const, id: ready ? String(adapter.id) : null, reason: ready ? "signed live decision adapter is frozen with the candidate" : "formal mechanism lacks a signed semantics-preserving live decision adapter"}};
  });
  if (domains.length !== eligible.size) throw new Error("Formal canary eligible domains are absent from the signed freeze");
  const status: FormalCanaryStatus = !domains.length ? "no-candidate" : domains.every((domain: FormalCanaryHandoff["domains"][number]) => domain.adapter.status === "ready") ? "execution-ready" : "adapter-required";
  const core = {schemaVersion: 1 as const, authority: "limited-canary-handoff-no-automatic-activation" as const, status, source: {freezeSha256: freeze.sha256, summarySha256: summary.sha256}, domains, control: {seasons: boundedInteger(options.seasons ?? 2, 1, 6), applicationRate: bounded(options.applicationRate ?? .1, .001, .5), maximumApplicationsPerSeason: boundedInteger(options.maximumApplicationsPerSeason ?? 12, 1, 100), rollbackOn: ["artifact-binding-failure", "technical-failure", "statistically-supported-regression", "application-budget-breach"], promotion: "manual-review-required" as const}, automaticActivationAllowed: false as const};
  return {...core, sha256: canonicalSha(core)};
}

export function verifyFormalCanaryHandoff(value: FormalCanaryHandoff): void {
  const {sha256, ...core} = value;
  if (value.schemaVersion !== 1 || value.authority !== "limited-canary-handoff-no-automatic-activation" || value.automaticActivationAllowed !== false || canonicalSha(core) !== sha256 || (value.status === "no-candidate") !== (value.domains.length === 0) || (value.status === "execution-ready") !== (value.domains.length > 0 && value.domains.every(domain => domain.adapter.status === "ready"))) throw new Error("Invalid formal canary handoff");
}

function requireSigned(value: any, label: string): void { if (!value || !/^[a-f0-9]{64}$/i.test(String(value.sha256 ?? ""))) throw new Error(`Unsigned formal canary ${label}`); const {sha256, ...core} = value; if (canonicalSha(core) !== sha256) throw new Error(`Formal canary ${label} signature mismatch`); }
function bounded(value: number, minimum: number, maximum: number): number { if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`Canary value must be ${minimum}..${maximum}`); return value; }
function boundedInteger(value: number, minimum: number, maximum: number): number { if (!Number.isInteger(value)) throw new Error("Canary value must be an integer"); return bounded(value, minimum, maximum); }
function canonicalSha(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function canonical(value: any): any { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
