import fs from "node:fs";
import path from "node:path";
import {evaluateWhiteBoxCounterfactualBatch,whiteBoxCounterfactualBatchMarkdown,type WhiteBoxCounterfactualSample} from "../ai/whiteBox/counterfactualBatch";

const args=process.argv.slice(2),inputs=option("--inputs","").split(",").map(value=>value.trim()).filter(Boolean).map(value=>path.resolve(value)),out=path.resolve(option("--out","output/whitebox-counterfactual-batch")),minimum=integerOption("--minimum-samples",10,2,1000);
if(!inputs.length)throw new Error("--inputs requires one or more comma-separated experiment directories");
const samples:WhiteBoxCounterfactualSample[]=inputs.map(directory=>{const summary=read<any>(path.join(directory,"counterfactual-summary.json")),state=read<any>(path.join(directory,"incumbent","dynasty-state.json")),comparison=summary.comparison;return{seed:state.seed,caseId:summary.caseId??`${comparison.managerId}@${comparison.interventionSeason}`,prefixVerified:Boolean(summary.prefixVerified),comparison};});
const batch=evaluateWhiteBoxCounterfactualBatch(samples,minimum);fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,"counterfactual-batch.json"),`${JSON.stringify(batch,null,2)}\n`,"utf8");fs.writeFileSync(path.join(out,"counterfactual-batch.md"),whiteBoxCounterfactualBatchMarkdown(batch),"utf8");
console.log(JSON.stringify({promotion:batch.promotion,metrics:batch.metrics,issues:batch.issues,report:path.join(out,"counterfactual-batch.md")},null,2));if(batch.promotion==="blocked")process.exitCode=2;
function option(name:string,fallback:string):string{const index=args.indexOf(name);return index>=0?args[index+1]??fallback:fallback;}
function integerOption(name:string,fallback:number,min:number,max:number):number{const value=Number(option(name,String(fallback)));if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${name} must be ${min}..${max}`);return value;}
function read<T>(file:string):T{return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
