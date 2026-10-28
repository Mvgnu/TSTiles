import { strict as assert } from "node:assert";
import { spawn, execFile as execFileCallback, type ChildProcessWithoutNullStreams } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer, createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

type TestFunction = (name: string, fn: () => void | Promise<void>, timeout?: number) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

const execFile = promisify(execFileCallback);
const projectRoot = resolve(__dirname, "../../..");
const executablePath = join(projectRoot, "dist/app/demo-server.js");
const typescriptPath = join(projectRoot, "node_modules/typescript/bin/tsc");
const sourceDatabasePath = join(projectRoot, "prisma/dev.db");
const pmtilesPath = join(projectRoot, "src/domains/tile-resolver/__fixtures__/test_fixture_1.pmtiles");
const stylePath = join(projectRoot, "assets/styles/seed/style.json");

const validProductionSecrets = {
  ADMIN_API_TOKEN: "0U0EkjpQDrwm6YDVV4IKHrOBUk-OoDFtX16CH1CWN6A",
  ADMIN_TOKEN: "0U0EkjpQDrwm6YDVV4IKHrOBUk-OoDFtX16CH1CWN6A",
  CSRF_SIGNING_KEY: "0040eb7fc425136c97c36f23e6134959141821d5a74cb8f83eead0b6c862a0d3",
  IP_HASH_KEY: "0b95b959cb5e5eb8135341cc64fb31cd9bca225f445806667a56e680bfb162c1",
  MFA_ENCRYPTION_KEY: "2c4b97e4c46f72900dd6eb20ed7cefb0d7f366ccf2275195fa2450c0072a334e",
} as const;
const reusedAdminToken = "K7mQ2vR9xP4sD8wN3cH6zB1fT5yG0jLA";

interface ProcessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

async function buildExecutable(): Promise<void> {
  await execFile(process.execPath, [typescriptPath, "-p", join(projectRoot, "tsconfig.json"), "--pretty", "false"], {
    cwd: projectRoot,
  });
}

let executableBuild: Promise<void> | undefined;

function ensureExecutableBuilt(): Promise<void> {
  executableBuild ??= buildExecutable();
  return executableBuild;
}

async function reserveUnusedPort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
  return address.port;
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolveConnection) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolveConnection(false);
    }, 500);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolveConnection(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolveConnection(false);
    });
  });
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolveExit, rejectExit) => {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectExit(new Error(`server process did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectExit(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal, stdout, stderr });
    });
  });
}

function waitForListener(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<string> {
  return new Promise((resolveListener, rejectListener) => {
    let output = "";
    const onData = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (output.includes("Local server running")) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolveListener(output);
      }
    };
    const timer = setTimeout(() => {
      child.stdout.off("data", onData);
      rejectListener(new Error(`server did not report a listener within ${timeoutMs}ms: ${output}`));
    }, timeoutMs);
    child.stdout.on("data", onData);
  });
}

function startServer(env: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [executablePath], {
    cwd: projectRoot,
    env,
    stdio: "pipe",
  });
}

function productionEnv(root: string, databasePath: string, port: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATABASE_URL: `file:${databasePath}`,
    OBJECT_STORE_MODE: "filesystem",
    OBJECT_STORE_BUCKET: root,
    ALLOWED_TILES_TOKENS: "fixture-public-token",
    ALLOWED_ORIGINS: "*",
    DEMO_PMTILES_PATH: pmtilesPath,
    DEMO_STYLE_FILES: stylePath,
    OBSERVABILITY_LOG_SINK: "stdout",
    EMAIL_PROVIDER: "brevo",
    EMAIL_SENDER_ADDRESS: "server@example.test",
    EMAIL_SENDER_NAME: "Tileserver",
    BREVO_API_KEY: "process-boundary-test-key",
    BREVO_WEBHOOK_SECRET: "process-boundary-test-webhook-secret",
    BREVO_TEMPLATE_ID_EMAIL_VERIFICATION: "1",
    BREVO_TEMPLATE_ID_WELCOME: "2",
    BREVO_TEMPLATE_ID_PASSWORD_RESET: "3",
    BREVO_TEMPLATE_ID_MAGIC_LINK: "4",
    BREVO_TEMPLATE_ID_WORKSPACE_INVITATION: "5",
    BREVO_TEMPLATE_ID_MEMBER_REMOVED: "6",
    BREVO_TEMPLATE_ID_BILLING_RECEIPT: "7",
    BREVO_TEMPLATE_ID_QUOTA_APPROACHING: "8",
    BREVO_TEMPLATE_ID_QUOTA_EXCEEDED: "9",
    BREVO_TEMPLATE_ID_KEY_ROTATED_RECEIPT: "10",
    BREVO_TEMPLATE_ID_ABUSE_WARNING: "11",
    BREVO_TEMPLATE_ID_PLAN_CHANGE_CONFIRMATION: "12",
    BREVO_TEMPLATE_ID_ACCOUNT_DELETION_INITIATED: "13",
    BREVO_TEMPLATE_ID_ACCOUNT_DELETION_COMPLETED: "14",
    BREVO_TEMPLATE_ID_DATA_EXPORT_READY: "15",
    ...validProductionSecrets,
  };
}

test("built executable rejects unsafe production secrets before opening a listener", async () => {
  await ensureExecutableBuilt();
  const root = await mkdtemp(join(tmpdir(), "tileserver-security-startup-"));
  try {
    const databasePath = join(root, "server.db");
    await copyFile(sourceDatabasePath, databasePath);

    const weakCases = [
      {
        label: "uniform admin token",
        overrides: {
          ADMIN_API_TOKEN: "a".repeat(32),
          ADMIN_TOKEN: "a".repeat(32),
        },
        expectedError: /ADMIN_API_TOKEN.*repeated pattern/,
      },
      {
        label: "distinct repeated-byte scoped keys",
        overrides: {
          CSRF_SIGNING_KEY: "0".repeat(64),
          IP_HASH_KEY: "1".repeat(64),
          MFA_ENCRYPTION_KEY: "2".repeat(64),
        },
        expectedError: /CSRF_SIGNING_KEY.*repeated pattern/,
      },
      {
        label: "admin token reused as the decoded CSRF signing key",
        overrides: {
          ADMIN_API_TOKEN: reusedAdminToken,
          ADMIN_TOKEN: reusedAdminToken,
          CSRF_SIGNING_KEY: Buffer.from(reusedAdminToken, "utf8").toString("hex"),
        },
        expectedError: /ADMIN_API_TOKEN.*CSRF_SIGNING_KEY.*distinct secrets/,
      },
    ] as const;

    for (const weak of weakCases) {
      const port = await reserveUnusedPort();
      const child = startServer({
        ...productionEnv(root, databasePath, port),
        ...weak.overrides,
      });
      const result = await waitForExit(child, 5_000);
      assert.notEqual(result.code, 0, `${weak.label} unexpectedly exited successfully`);
      assert.match(result.stderr, weak.expectedError);
      assert.doesNotMatch(result.stdout, /Local server running/);
      assert.equal(await canConnect(port), false, `${weak.label} opened a listener`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test("built executable opens a listener with generated production secrets", async () => {
  await ensureExecutableBuilt();
  const root = await mkdtemp(join(tmpdir(), "tileserver-security-control-"));
  const databasePath = join(root, "server.db");
  await copyFile(sourceDatabasePath, databasePath);
  const port = await reserveUnusedPort();
  const child = startServer(productionEnv(root, databasePath, port));
  try {
    const output = await waitForListener(child, 10_000);
    assert.match(output, /Local server running/);
    assert.equal(await canConnect(port), true);
  } finally {
    const exit = waitForExit(child, 5_000);
    child.kill("SIGKILL");
    const result = await exit;
    assert.equal(result.signal, "SIGKILL", result.stderr);
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
