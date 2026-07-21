export interface WhiteBoxSamplingProgress {samples:number;seeds:number;targetSamples:number;minimumSeeds:number;complete:boolean;remainingSamples:number;remainingSeeds:number}
export interface WhiteBoxExperimentCase {domain:string;decisionId:string;experimentGate?:{recommended:boolean;hardRejections:string[]}|null}
export interface WhiteBoxExperimentEligibility {eligible:boolean;reasons:string[]}

export function whiteBoxSamplingProgress(sampleSeeds:readonly string[],targetSamples=10,minimumSeeds=5):WhiteBoxSamplingProgress {
  if(!Number.isInteger(targetSamples)||targetSamples<1)throw new Error("targetSamples must be positive");
  if(!Number.isInteger(minimumSeeds)||minimumSeeds<1||minimumSeeds>targetSamples)throw new Error("minimumSeeds must be within 1..targetSamples");
  const seeds=new Set(sampleSeeds).size,samples=sampleSeeds.length;
  return {samples,seeds,targetSamples,minimumSeeds,complete:samples>=targetSamples&&seeds>=minimumSeeds,remainingSamples:Math.max(0,targetSamples-samples),remainingSeeds:Math.max(0,minimumSeeds-seeds)};
}

export function whiteBoxProductionEvidenceMinimum(targetSamples:number):number {
  if(!Number.isInteger(targetSamples)||targetSamples<1)throw new Error("targetSamples must be positive");
  return Math.max(10,targetSamples);
}

export function whiteBoxExperimentEligibility(entry:WhiteBoxExperimentCase):WhiteBoxExperimentEligibility {
  if(entry.domain==="keeper")return{eligible:true,reasons:[]};
  if(entry.decisionId.startsWith("acquire:")){if(!entry.experimentGate)return{eligible:false,reasons:["missing-acquisition-assist-gate"]};return entry.experimentGate.recommended?{eligible:true,reasons:[]}:{eligible:false,reasons:[...entry.experimentGate.hardRejections]};}
  if(entry.decisionId.startsWith("market:background-action:"))return{eligible:true,reasons:[]};
  if(entry.decisionId.startsWith("market:trade:")){
    if(!entry.experimentGate)return{eligible:false,reasons:["missing-trade-assist-gate"]};
    return entry.experimentGate.recommended?{eligible:true,reasons:[]}:{eligible:false,reasons:[...entry.experimentGate.hardRejections]};
  }
  return{eligible:false,reasons:["unsupported-counterfactual-domain"]};
}

export function firstEligibleWhiteBoxCase(cases:readonly WhiteBoxExperimentCase[]):number|null {
  const index=cases.findIndex(entry=>whiteBoxExperimentEligibility(entry).eligible);
  return index<0?null:index+1;
}
