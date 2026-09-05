import path from "node:path";
import { pathToFileURL } from "node:url";

const APP_NAMES = new Set(["MintBinder", "Mint", "mintbinder"]);

export function selectMintBinderPm2App(processes, { cwd = process.cwd() } = {}) {
  if (!Array.isArray(processes)) {
    throw new Error("PM2 process data is not an array.");
  }

  const matches = processes.filter((entry) => APP_NAMES.has(entry?.name ?? entry?.pm2_env?.name));

  if (matches.length !== 1) {
    throw new Error(`Expected exactly one named Mint Binder PM2 process; found ${matches.length}.`);
  }

  const selected = matches[0];
  const name = selected?.name ?? selected?.pm2_env?.name;
  const environment = selected?.pm2_env;
  const processCwd = typeof environment?.pm_cwd === "string" ? environment.pm_cwd : "";
  const processArgs = environment?.args;

  if (environment?.status !== "online") {
    throw new Error(`PM2 process ${name} is not online.`);
  }
  if (!processCwd || path.resolve(processCwd) !== path.resolve(cwd)) {
    throw new Error(`PM2 process ${name} does not use the deployment working directory.`);
  }
  if (environment?.pm_exec_path !== "/usr/bin/npm") {
    throw new Error(`PM2 process ${name} does not execute /usr/bin/npm.`);
  }
  if (!Array.isArray(processArgs) || processArgs.length !== 1 || processArgs[0] !== "start") {
    throw new Error(`PM2 process ${name} does not use the expected npm start arguments.`);
  }

  return name;
}

async function main() {
  let input = "";

  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  const processes = JSON.parse(input);
  process.stdout.write(selectMintBinderPm2App(processes));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(`Unsafe Mint Binder PM2 process selection: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
