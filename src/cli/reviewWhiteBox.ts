import fs from "node:fs";
import path from "node:path";
import {reviewWhiteBoxDifferences, whiteBoxDifferenceMarkdown} from "../ai/whiteBox/review";

const args=process.argv.slice(2),root=path.resolve(option("--out","output/draft-league-v12")),destination=path.resolve(option("--report-out",root));
fs.mkdirSync(destination,{recursive:true});
const review=reviewWhiteBoxDifferences(root);
fs.writeFileSync(path.join(destination,"whitebox-differences.json"),`${JSON.stringify(review,null,2)}\n`,"utf8");
fs.writeFileSync(path.join(destination,"whitebox-differences.md"),whiteBoxDifferenceMarkdown(review),"utf8");
console.log(JSON.stringify({cases:review.cases.length,experimentEligible:review.metrics.experimentEligible,experimentIneligible:review.metrics.experimentIneligible,comparisons:review.comparisons,agreements:review.agreements,classifications:review.metrics.byClassification,report:path.join(destination,"whitebox-differences.md")},null,2));
function option(name:string,fallback:string):string{const index=args.indexOf(name);return index>=0?args[index+1]??fallback:fallback;}
