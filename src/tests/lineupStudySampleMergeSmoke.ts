import assert from "node:assert/strict";
import {mergeLineupStudySampleArchives, type LineupStudySampleArchive} from "../ai/whiteBox/lineupStudySampleMerge";

const archive = (firstSeason: number, finalSeason: number): LineupStudySampleArchive => ({schemaVersion: 1, sourceStateSha256: `state-${firstSeason}`, firstSeason, finalSeason, rows: Array.from({length: finalSeason - firstSeason + 1}, (_, index) => ({season: firstSeason + index, managerId: "manager-01", seriesId: `series-${firstSeason + index}`}))});
const merged = mergeLineupStudySampleArchives([archive(3, 3), archive(1, 2)]); assert.equal(merged.schemaVersion, 2); assert.equal(merged.firstSeason, 1); assert.equal(merged.finalSeason, 3); assert.equal(merged.rows.length, 3); assert.equal(merged.provenance.segments.length, 2);
assert.throws(() => mergeLineupStudySampleArchives([archive(1, 1), archive(3, 3)]), /Non-contiguous/);
assert.throws(() => mergeLineupStudySampleArchives([archive(1, 1)]), /at least two/);
console.log("Lineup study sample merge smoke passed: sorting, continuity, dedupe, and provenance");
