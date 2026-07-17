import crypto from "node:crypto";
import type {WhiteBoxCandidateTrace} from "./decision";

export const BATTLE_ASSIST_SCOPE_VERSION="battle-assist-scope-v1";
export interface BattleAssistScope {version:typeof BATTLE_ASSIST_SCOPE_VERSION;id:string;classification:"rational-correction"|"reasonable-style-choice"|"illegal-incumbent";ownSpecies:string;opponentSpecies:string;incumbentAction:string;selectedAction:string}

export function buildBattleAssistScope(input:{ownSpecies:string|null|undefined;opponentSpecies:string|null|undefined;incumbent:string;selected:string;incumbentTarget?:string;selectedTarget?:string;incumbentCandidate:WhiteBoxCandidateTrace|undefined}):BattleAssistScope{
  const classification=input.incumbentCandidate&&!input.incumbentCandidate.eligible?"illegal-incumbent":input.incumbentCandidate?.reasonable?"reasonable-style-choice":"rational-correction",ownSpecies=normalize(input.ownSpecies),opponentSpecies=normalize(input.opponentSpecies),incumbentAction=battleActionFamily(input.incumbent,input.incumbentTarget),selectedAction=battleActionFamily(input.selected,input.selectedTarget);
  const canonical=[BATTLE_ASSIST_SCOPE_VERSION,classification,ownSpecies,opponentSpecies,incumbentAction,selectedAction].join("|");
  return{version:BATTLE_ASSIST_SCOPE_VERSION,id:crypto.createHash("sha256").update(canonical).digest("hex").slice(0,24),classification,ownSpecies,opponentSpecies,incumbentAction,selectedAction};
}

export function battleActionFamily(value:string,target?:string):string{const move=value.match(/^move\s+(\S+)/i);if(move)return`move:${normalize(move[1])}:${value.includes("terastallize")?"tera":"plain"}`;if(/^switch\s/i.test(value))return`switch:${normalize(target)}`;return normalize(value)||"unknown";}
function normalize(value:string|null|undefined):string{return String(value??"unknown").toLowerCase().replace(/[^a-z0-9]+/g,"")||"unknown";}
