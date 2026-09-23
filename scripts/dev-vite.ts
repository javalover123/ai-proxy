import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";

const devServerPort = 5205;
const devServerHost = process.env.TAURI_DEV_HOST || "127.0.0.1";

function isPortInUse(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      resolve(err.code === "EADDRINUSE");
    });
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port, host);
  });
}

function describeOccupyingProcess(port: number): string | null {
  if (process.platform === "win32") {
    const netstat = spawnSync("netstat", ["-ano"], { encoding: "utf8" });
    const line = netstat.stdout.split("\n").find((row) => row.includes(`:${port}`) && row.includes("LISTENING"));
    if (!line) return null;

    const pid = Number.parseInt(line.trim().split(/\s+/).at(-1) ?? "", 10);
    if (Number.isNaN(pid)) return null;

    const tasklist = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
    });
    const name = tasklist.stdout.split(",")[0]?.replaceAll('"', "").trim();
    return name ? `${name} (PID ${pid})` : `PID ${pid}`;
  }

  const lsof = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  const row = lsof.stdout.split("\n")[1]?.trim();
  if (!row) return null;

  const [name, , , , pid] = row.split(/\s+/);
  return pid ? `${name} (PID ${pid})` : (name ?? null);
}

function printPortInUseHelp(processInfo: string | null) {
  console.error("");
  console.error("开发服务器无法启动：端口已被占用");
  console.error(`  地址: http://${devServerHost}:${devServerPort}`);
  if (processInfo) {
    console.error(`  占用进程: ${processInfo}`);
  }
  console.error("");
  console.error("常见原因: 上一次 bun tauri dev 或 vite 未正常退出，仍在后台运行。");
  console.error("");
  console.error("解决方法:");
  console.error("  1. 关闭仍占用端口的终端窗口或进程");
  if (process.platform === "win32") {
    console.error(
      `  2. PowerShell 释放端口: Get-NetTCPConnection -LocalPort ${devServerPort} | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`,
    );
  } else {
    console.error(`  2. 释放端口: lsof -ti :${devServerPort} | xargs kill`);
  }
  console.error("  3. 或修改 vite.config.ts 中的 devServerPort");
  console.error("");
}

async function main() {
  if (await isPortInUse(devServerPort, devServerHost)) {
    printPortInUseHelp(describeOccupyingProcess(devServerPort));
    process.exit(1);
  }

  const viteBin = path.join(process.cwd(), "node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [viteBin], { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

void main();
