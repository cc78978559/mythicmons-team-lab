import path from "node:path";
import {validateRegistryDirectory} from "../draft/registrySnapshot";

const directory = path.resolve(process.argv[process.argv.indexOf("--dir") + 1] || "data/draft");
const result = validateRegistryDirectory(directory);
console.log(JSON.stringify({valid: true, directory, revision: result.revision, hash: result.hash, members: result.memberCount, files: result.files}, null, 2));
