import assert from "node:assert/strict";
import {POSITION_FEATURES, POSITION_FEATURE_VERSION, POSITION_VALUE_MODEL_VERSION, pairedPositionFeatures, positionFeatures, predictPairedPositionValue, type PositionValueModel} from "../ai/positionValue";
import type {PositionSnapshot} from "../showdown/choice";

const favorable = snapshot(6, 3, 5.2, 2.1);
const unfavorable = snapshot(3, 6, 2.1, 5.2);
const features = positionFeatures(favorable);
assert.equal(features.length, POSITION_FEATURES.length);

const paired = pairedPositionFeatures(favorable, unfavorable);
const reversed = pairedPositionFeatures(unfavorable, favorable);
assert.equal(paired.every((value, index) => Math.abs(value + reversed[index]) < 1e-9), true);

const model: PositionValueModel = {
  schemaVersion: 1,
  version: POSITION_VALUE_MODEL_VERSION,
  featureVersion: POSITION_FEATURE_VERSION,
  features: POSITION_FEATURES,
  coefficients: POSITION_FEATURES.map(() => 0),
  regularization: 0,
  structuralRegularization: 0,
  trainedSamples: 0,
  trainedBattles: 0,
  trainingSignature: "fixture",
  sha256: "0".repeat(64),
};
assert.equal(predictPairedPositionValue(favorable, unfavorable, model), 0.5);
assert.equal(predictPairedPositionValue(unfavorable, favorable, model), 0.5);

console.log("Position value contract smoke passed: feature width, perspective symmetry, and fixed-model inference");

function snapshot(ownRemaining: number, opponentRemaining: number, ownHp: number, opponentHp: number): PositionSnapshot {
  const side = (remaining: number, hpTotal: number) => ({remaining, hpTotal, activeHp: hpTotal / 6, statusCount: 0, activeStatus: false, positiveBoosts: 0, negativeBoosts: 0, hazards: 0, screens: 0});
  return {schemaVersion: 1, encoderVersion: "position-snapshot-v1", turn: 12, own: side(ownRemaining, ownHp), opponent: side(opponentRemaining, opponentHp), forcedSwitch: false, trapped: false, weather: null, fieldConditions: [], information: {ownHp: "private-request", opponentHp: "public-estimate"}};
}
