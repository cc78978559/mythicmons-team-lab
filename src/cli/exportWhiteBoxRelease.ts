import fs from "node:fs";
import path from "node:path";
import {auditWhiteBoxOutput} from "../ai/whiteBox/audit";
import {buildWhiteBoxReleaseArtifacts,verifyWhiteBoxRelease,writeWhiteBoxRelease} from "../ai/whiteBox/release";
import {reviewWhiteBoxDifferences} from "../ai/whiteBox/review";
import {loadDynastyState} from "../draft/dynastyStateStore";

const args=process.argv.slice(2),source=path.resolve(option("--source","output/draft-league-v12")),out=path.resolve(option("--out","output/whitebox-ai-release"));
if(args.includes("--verify-only")){const manifest=verifyWhiteBoxRelease(out);console.log(JSON.stringify({verified:true,releaseId:manifest.releaseId,files:Object.keys(manifest.files).length,out},null,2));process.exit(0);}
const state=loadDynastyState<any>(path.join(source,"dynasty-state.json")),audit=auditWhiteBoxOutput(source),review=reviewWhiteBoxDifferences(source);
const artifacts=buildWhiteBoxReleaseArtifacts(state,audit,review);writeWhiteBoxRelease(out,artifacts,args.includes("--force"));const manifest=verifyWhiteBoxRelease(out);
console.log(JSON.stringify({releaseId:manifest.releaseId,completedSeason:manifest.completedSeason,nextSeason:manifest.nextSeason,managers:manifest.managerCount,files:Object.keys(manifest.files).length,bytes:Object.values(manifest.files).reduce((sum,file)=>sum+file.bytes,0),audit:{promotion:audit.promotion,coverage:audit.coverage,fatal:audit.fatalCount,warnings:audit.warningCount},differences:{cases:review.cases.length,eligible:review.metrics.experimentEligible},out},null,2));
function option(name:string,fallback:string):string{const index=args.indexOf(name);return index>=0?args[index+1]??fallback:fallback;}
function read<T>(file:string):T{return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
