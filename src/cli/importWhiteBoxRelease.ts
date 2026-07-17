import path from "node:path";
import {writeCareerCheckpointFromWhiteBoxRelease} from "../ai/whiteBox/release";

const args=process.argv.slice(2),release=path.resolve(option("--release","output/whitebox-ai-release")),out=path.resolve(option("--out","output/whitebox-ai-checkpoint"));
const result=writeCareerCheckpointFromWhiteBoxRelease(release,out,args.includes("--force"));
console.log(JSON.stringify({releaseId:result.releaseId,checkpointManifest:result.manifest,checkpointArchive:result.archive,sourceBytes:result.sourceBytes,compressedBytes:result.compressedBytes,out},null,2));
function option(name:string,fallback:string):string{const index=args.indexOf(name);return index>=0?args[index+1]??fallback:fallback;}
