import type {LineageIdentity} from "./naturalEvolution";

export interface LineageView {lineage: LineageIdentity; lineageHistory: readonly LineageIdentity[]}

export function founderCapacity(populationCapacity: number, maximumSharePercent: number): number {
  return Math.max(1, Math.ceil(populationCapacity * maximumSharePercent / 100));
}

export function ancestorLineageIds(view: LineageView, depth: number): Set<string> {
  const records = new Map([...view.lineageHistory, view.lineage].map(lineage => [lineage.lineageId, lineage]));
  const ancestors = new Set<string>(), queue: Array<{id: string; distance: number}> = [{id: view.lineage.lineageId, distance: 0}];
  while (queue.length) {
    const current = queue.shift()!;
    if (ancestors.has(current.id) || current.distance > depth) continue;
    ancestors.add(current.id);
    if (current.distance === depth) continue;
    for (const parentId of records.get(current.id)?.parentLineageIds ?? []) queue.push({id: parentId, distance: current.distance + 1});
  }
  return ancestors;
}

export function areLineagesRelated(left: LineageView, right: LineageView, depth: number): boolean {
  if (depth <= 0) return false;
  const leftAncestors = ancestorLineageIds(left, depth), rightAncestors = ancestorLineageIds(right, depth);
  for (const lineageId of leftAncestors) if (rightAncestors.has(lineageId)) return true;
  return false;
}
