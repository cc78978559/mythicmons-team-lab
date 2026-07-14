import assert from "node:assert/strict";
import {allocateBulkStatPoints, type BulkStatAllocatorOptions} from "../draft/bulkStatAllocator";

const cases: Array<{name: string; input: BulkStatAllocatorOptions; expected: [number, number, number]}> = [
  {name: "Beedrill with Assault Vest", input: {baseStats: {hp: 65, def: 40, spd: 80}, points: 80, specialDefenseMultiplier: 1.5}, expected: [66, 119, 80]},
  {name: "Onix with Sassy nature", input: {baseStats: {hp: 35, def: 160, spd: 45}, points: 140, specialDefenseNature: 1.1}, expected: [84, 160, 136]},
  {name: "Wigglytuff with Sassy nature and Assault Vest", input: {baseStats: {hp: 140, def: 70, spd: 50}, points: 90, specialDefenseNature: 1.1, specialDefenseMultiplier: 1.5}, expected: [167, 126, 57]},
  {name: "Persian with Fur Coat and Assault Vest", input: {baseStats: {hp: 65, def: 115, spd: 65}, points: 60, defenseMultiplier: 2, specialDefenseMultiplier: 1.5}, expected: [69, 115, 121]},
  {name: "Azumarill with Assault Vest", input: {baseStats: {hp: 100, def: 80, spd: 80}, points: 80, specialDefenseMultiplier: 1.5}, expected: [116, 144, 80]},
  {name: "Furret", input: {baseStats: {hp: 85, def: 64, spd: 55}, points: 90}, expected: [146, 74, 74]},
  {name: "Meganium", input: {baseStats: {hp: 80, def: 100, spd: 100}, points: 90}, expected: [170, 100, 100]},
  {name: "Delibird revised 110-point budget", input: {baseStats: {hp: 45, def: 45, spd: 45}, points: 110}, expected: [121, 62, 62]},
  {name: "Jumpluff with Calm nature", input: {baseStats: {hp: 75, def: 70, spd: 95}, points: 90, specialDefenseNature: 1.1}, expected: [126, 109, 95]},
  {name: "Umbreon with Calm nature", input: {baseStats: {hp: 95, def: 100, spd: 130}, points: 70, specialDefenseNature: 1.1}, expected: [118, 147, 130]},
  {name: "Sableye with Calm nature", input: {baseStats: {hp: 50, def: 75, spd: 65}, points: 80, specialDefenseNature: 1.1}, expected: [129, 76, 65]},
  {name: "Mawile", input: {baseStats: {hp: 50, def: 85, spd: 55}, points: 90}, expected: [110, 85, 85]},
  {name: "Milotic with Bold Marvel Scale", input: {baseStats: {hp: 95, def: 79, spd: 125}, points: 40, defenseNature: 1.1, defenseMultiplier: 1.5}, expected: [104, 79, 156]},
  {name: "Mightyena with Assault Vest", input: {baseStats: {hp: 70, def: 70, spd: 60}, points: 100, specialDefenseMultiplier: 1.5}, expected: [125, 115, 60]},
  {name: "Delcatty", input: {baseStats: {hp: 70, def: 65, spd: 55}, points: 120}, expected: [154, 78, 78]},
  {name: "Luxray", input: {baseStats: {hp: 65, def: 79, spd: 79}, points: 70}, expected: [135, 79, 79]},
  {name: "Glameow with Eviolite and Assault Vest", input: {baseStats: {hp: 49, def: 42, spd: 37}, points: 80, defenseMultiplier: 1.5, specialDefenseMultiplier: 2.25}, expected: [91, 80, 37]},
  {name: "Bibarel official bulk plus 80", input: {baseStats: {hp: 79, def: 60, spd: 60}, points: 80}, expected: [139, 70, 70]},
  {name: "Pachirisu official bulk plus 80", input: {baseStats: {hp: 60, def: 70, spd: 90}, points: 80}, expected: [120, 90, 90]},
  {name: "Kricketune official bulk plus 40", input: {baseStats: {hp: 77, def: 51, spd: 51}, points: 40}, expected: [109, 55, 55]},
  {name: "Watchog official bulk plus 147", input: {baseStats: {hp: 60, def: 69, spd: 69}, points: 147}, expected: [171, 87, 87]},
  {name: "Emolga official bulk plus 60", input: {baseStats: {hp: 55, def: 60, spd: 60}, points: 60}, expected: [115, 60, 60]},
  {name: "Whimsicott swapped official HP and Speed plus 60", input: {baseStats: {hp: 116, def: 85, spd: 75}, points: 60}, expected: [166, 85, 85]},
  {name: "Meowstic official bulk plus 100", input: {baseStats: {hp: 74, def: 76, spd: 81}, points: 100}, expected: [165, 83, 83]},
  {name: "Furfrou official bulk plus 52 with Fur Coat", input: {baseStats: {hp: 75, def: 60, spd: 90}, points: 52, defenseMultiplier: 2}, expected: [82, 60, 135]},
  {name: "Dragalge official bulk plus 60", input: {baseStats: {hp: 65, def: 90, spd: 123}, points: 60}, expected: [92, 123, 123]},
  {name: "Dedenne official bulk plus 50", input: {baseStats: {hp: 67, def: 57, spd: 67}, points: 50}, expected: [107, 67, 67]},
  {name: "Pidgeot official bulk plus 120", input: {baseStats: {hp: 83, def: 75, spd: 70}, points: 120}, expected: [172, 88, 88]},
  {name: "Electabuzz swapped attack and defense plus 90 with Eviolite", input: {baseStats: {hp: 65, def: 83, spd: 85}, points: 90, defenseMultiplier: 1.5, specialDefenseMultiplier: 1.5}, expected: [153, 85, 85]},
  {name: "Magmar swapped attack and defense plus 50 with Eviolite", input: {baseStats: {hp: 65, def: 95, spd: 85}, points: 50, defenseMultiplier: 1.5, specialDefenseMultiplier: 1.5}, expected: [105, 95, 95]},
  {name: "Weezing official bulk plus 50", input: {baseStats: {hp: 65, def: 120, spd: 70}, points: 50}, expected: [66, 120, 119]},
  {name: "Kangaskhan official bulk plus 40", input: {baseStats: {hp: 105, def: 80, spd: 80}, points: 40}, expected: [145, 80, 80]},
];

for (const testCase of cases) {
  const result = allocateBulkStatPoints(testCase.input);
  assert.deepEqual(
    [result.baseStats.hp, result.baseStats.def, result.baseStats.spd],
    testCase.expected,
    testCase.name,
  );
}

console.log(`Bulk stat allocator smoke passed (${cases.length} cases)`);
