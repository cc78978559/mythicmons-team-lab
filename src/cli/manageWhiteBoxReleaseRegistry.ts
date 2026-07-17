import path from "node:path";
import {activateWhiteBoxRelease,readWhiteBoxReleaseRegistry,registerWhiteBoxRelease,rejectWhiteBoxRelease,rollbackWhiteBoxRelease,verifyWhiteBoxReleaseRegistry} from "../ai/whiteBox/releaseRegistry";

const args=process.argv.slice(2),root=path.resolve(option("--registry","output/whitebox-release-registry")),action=option("--action","status");
let result:any;
if(action==="register"){const release=required("--release");result=registerWhiteBoxRelease(root,path.resolve(release));}
else if(action==="activate")result=activateWhiteBoxRelease(root,required("--release-id"));
else if(action==="reject")result=rejectWhiteBoxRelease(root,required("--release-id"),required("--reason"));
else if(action==="rollback")result=rollbackWhiteBoxRelease(root);
else if(action==="verify")result=verifyWhiteBoxReleaseRegistry(root);
else if(action==="status")result=readWhiteBoxReleaseRegistry(root);
else throw new Error(`Unsupported registry action: ${action}`);
console.log(JSON.stringify({action,registry:root,result},null,2));
function option(name:string,fallback:string):string{const index=args.indexOf(name);return index>=0?args[index+1]??fallback:fallback;}
function required(name:string):string{const index=args.indexOf(name),value=index>=0?args[index+1]:undefined;if(!value)throw new Error(`Missing required option: ${name}`);return value;}
