// Shared helpers for hosting tests that launch real nginx. Not a test file itself.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const nginxSnippets = join(repo, "ops", "nginx");
export const nginx = process.env.NGINX_BIN || "nginx";
export const run = promisify(execFile);

export async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
  return port;
}

export async function requireNginx() {
  // Fails, never skips: a missing server would otherwise read as a green hosting gate.
  try {
    const { stderr } = await run(nginx, ["-V"], { timeout: 5_000 });
    return stderr;
  } catch (error) {
    throw new Error("Hosting tests require nginx (production runs 1.28). Install it or set NGINX_BIN to its executable.", { cause: error });
  }
}

/** Starts nginx serving `site` through ops/nginx/tstiles-routes.conf (unmodified) on 127.0.0.1. */
export async function serveSite(root, site) {
  for (const name of ["client_body", "proxy", "fastcgi", "uwsgi", "scgi"]) await mkdir(join(root, "temp", name), { recursive: true });
  const port = await unusedPort();
  const config = join(root, "nginx.conf");
  await writeFile(config, `
daemon off;
worker_processes 1;
pid ${join(root, "nginx.pid")};
error_log stderr warn;
events { worker_connections 64; }
http {
  access_log off;
${["client_body", "proxy", "fastcgi", "uwsgi", "scgi"].map((name) => `  ${name}_temp_path ${join(root, "temp", name)};`).join("\n")}
  sendfile on;
  include ${join(nginxSnippets, "tstiles-http.conf")};
  server {
    listen 127.0.0.1:${port};
    server_name _;
    root ${site};
    include ${join(nginxSnippets, "tstiles-routes.conf")};
  }
}
`);
  await run(nginx, ["-t", "-q", "-p", root, "-e", "stderr", "-c", config], { timeout: 10_000 });
  const server = spawn(nginx, ["-p", root, "-e", "stderr", "-c", config], { stdio: ["ignore", "ignore", "pipe"] });
  const state = { server, logs: "", spawnError: undefined, base: `http://127.0.0.1:${port}` };
  server.stderr.setEncoding("utf8");
  server.stderr.on("data", (chunk) => { state.logs = (state.logs + chunk).slice(-16_000); });
  server.on("error", (error) => { state.spawnError = error; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (state.spawnError) throw state.spawnError;
    if (server.exitCode !== null) throw new Error(`nginx exited during startup:\n${state.logs}`);
    try {
      const response = await fetch(`${state.base}/`, { method: "HEAD", signal: AbortSignal.timeout(1_000) });
      if (response.status === 200 || response.status === 404) return state;
    } catch {
      // Startup is asynchronous; retry only during this bounded readiness loop.
    }
    await delay(50);
  }
  throw new Error(`nginx never became ready:\n${state.logs}`);
}

export async function stopNginx(state) {
  if (!state || state.server.exitCode !== null || state.spawnError) return;
  const closed = once(state.server, "close");
  state.server.kill("SIGQUIT");
  await Promise.race([closed, delay(5_000, undefined, { ref: false }).then(() => { state.server.kill("SIGKILL"); })]);
}
