#!/usr/bin/env node

const { execSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function listProjectNextDevPids(cwd) {
  let output = "";
  try {
    output = execSync("ps -ax -o pid=,command=", { encoding: "utf8" });
  } catch {
    return [];
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const firstSpace = line.indexOf(" ");
      if (firstSpace <= 0) return null;
      const pid = Number(line.slice(0, firstSpace).trim());
      const command = line.slice(firstSpace + 1).trim();
      if (!Number.isFinite(pid)) return null;
      return { pid, command };
    })
    .filter((entry) => entry !== null)
    .filter((entry) => entry.pid !== process.pid)
    .filter((entry) => entry.command.includes("next dev"))
    .filter((entry) => entry.command.includes(cwd))
    .map((entry) => entry.pid);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopProcesses(pids) {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // process may already be gone
    }
  }

  await sleep(600);

  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      process.kill(pid, "SIGKILL");
    } catch {
      // process already stopped
    }
  }
}

async function main() {
  const cwd = process.cwd();
  const pids = listProjectNextDevPids(cwd);

  if (pids.length > 0) {
    console.log(`[dev-safe] Encerrando ${pids.length} processo(s) next dev antigo(s): ${pids.join(", ")}`);
    await stopProcesses(pids);
  }

  const nextDir = path.join(cwd, ".next");
  try {
    fs.rmSync(nextDir, { recursive: true, force: true });
    console.log("[dev-safe] Cache .next limpo.");
  } catch {
    // ignore
  }

  const nextBin = path.join(cwd, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev"], {
    cwd,
    stdio: "inherit"
  });

  child.on("exit", (code, signal) => {
    if (typeof code === "number") {
      process.exit(code);
      return;
    }
    console.error(`[dev-safe] next dev finalizado por sinal ${signal ?? "desconhecido"}.`);
    process.exit(1);
  });
}

void main();
