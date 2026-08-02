export interface LineupStudySampleArchive {schemaVersion: number; sourceStateSha256: string; firstSeason: number; finalSeason: number; rows: any[]; provenance?: unknown}

export function mergeLineupStudySampleArchives(archivesInput: readonly LineupStudySampleArchive[]): LineupStudySampleArchive & {schemaVersion: 2; sourceStateSha256: "multiple"; provenance: {segments: Array<{sourceStateSha256: string; firstSeason: number; finalSeason: number; rows: number}>}} {
  if (archivesInput.length < 2) throw new Error("Lineup sample merge requires at least two archives");
  const archives = [...archivesInput].sort((left, right) => left.firstSeason - right.firstSeason);
  for (const archive of archives) {
    if (![1, 2].includes(archive.schemaVersion) || !archive.sourceStateSha256 || !Number.isInteger(archive.firstSeason) || !Number.isInteger(archive.finalSeason) || archive.firstSeason < 1 || archive.finalSeason < archive.firstSeason || !Array.isArray(archive.rows) || !archive.rows.length) throw new Error("Invalid lineup sample archive");
    const seasons = [...new Set(archive.rows.map(row => Number(row.season)))].sort((left, right) => left - right);
    if (seasons[0] !== archive.firstSeason || seasons.at(-1) !== archive.finalSeason || seasons.some((season, index) => season !== archive.firstSeason + index)) throw new Error(`Archive rows do not cover declared season range ${archive.firstSeason}-${archive.finalSeason}`);
  }
  for (let index = 1; index < archives.length; index++) if (archives[index].firstSeason !== archives[index - 1].finalSeason + 1) throw new Error(`Non-contiguous lineup sample archives: ${archives[index - 1].finalSeason} -> ${archives[index].firstSeason}`);
  const rows = archives.flatMap(archive => archive.rows), ids = rows.map(row => `${row.season}:${row.managerId}:${row.seriesId}`);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate lineup sample observation across archives");
  return {schemaVersion: 2, sourceStateSha256: "multiple", firstSeason: archives[0].firstSeason, finalSeason: archives.at(-1)!.finalSeason, rows, provenance: {segments: archives.map(archive => ({sourceStateSha256: archive.sourceStateSha256, firstSeason: archive.firstSeason, finalSeason: archive.finalSeason, rows: archive.rows.length}))}};
}
