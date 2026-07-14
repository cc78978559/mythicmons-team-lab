export interface RepairableContract {assetId?: string; family?: string}
export interface RepairableManager {id: string; contracts: RepairableContract[]}
export interface RepairableState {assets: Record<string, {ownerId: string | null; status?: string}>; managers: RepairableManager[]}
export interface RemovedContract {assetId: string; removedFrom: string; retainedBy: string}
export interface ReassignedAssetOwner {assetId: string; previousOwner: string | null; contractOwner: string}

export function repairDuplicateRetainedContracts<T extends RepairableState>(state: T): RemovedContract[] {
  const holders = new Map<string, Array<{manager: RepairableManager; contract: RepairableContract}>>();
  for (const manager of state.managers) for (const contract of manager.contracts) {
    if (!contract.assetId) continue;
    holders.set(contract.assetId, [...(holders.get(contract.assetId) ?? []), {manager, contract}]);
  }
  const removals: RemovedContract[] = [];
  for (const [assetId, entries] of holders) {
    if (entries.length < 2) continue;
    const ownerId = state.assets[assetId]?.ownerId;
    if (!ownerId || entries.filter(entry => entry.manager.id === ownerId).length !== 1) throw new Error(`Cannot safely repair ${assetId}: ledger owner ${ownerId ?? "none"} is not its unique contract holder`);
    for (const entry of entries) if (entry.manager.id !== ownerId) {
      entry.manager.contracts = entry.manager.contracts.filter(contract => contract !== entry.contract);
      removals.push({assetId, removedFrom: entry.manager.id, retainedBy: ownerId});
    }
  }
  return removals;
}

export function reconcileRetainedContractOwners<T extends RepairableState>(state: T): ReassignedAssetOwner[] {
  const owners = new Map<string, string>();
  const changes: ReassignedAssetOwner[] = [];
  for (const manager of state.managers) for (const contract of manager.contracts) {
    if (!contract.assetId) continue;
    const prior = owners.get(contract.assetId);
    if (prior) throw new Error(`Cannot reconcile duplicate contract ${contract.assetId} held by ${prior} and ${manager.id}`);
    owners.set(contract.assetId, manager.id);
    const asset = state.assets[contract.assetId];
    if (!asset) throw new Error(`Cannot reconcile missing asset ${contract.assetId}`);
    if (asset.ownerId !== manager.id) {
      changes.push({assetId: contract.assetId, previousOwner: asset.ownerId, contractOwner: manager.id});
      asset.ownerId = manager.id;
      asset.status = "owned";
    }
  }
  return changes;
}
