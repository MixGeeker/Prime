import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import net from 'node:net';
import process from 'node:process';

function parseArgs(argv) {
  const args = {
    mode: undefined, // dev | test
    detach: true,
    down: false,
    reset: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--mode') args.mode = argv[++i];
    else if (a.startsWith('--mode=')) args.mode = a.slice('--mode='.length);
    else if (a === '--detach') args.detach = true;
    else if (a === '--attach') args.detach = false;
    else if (a === '--down') args.down = true;
    else if (a === '--reset') args.reset = true;
  }

  if (args.reset) args.down = true;
  return args;
}

function run(cmd, cmdArgs, { title, env } = {}) {
  return new Promise((resolve, reject) => {
    if (title) {
      // eslint-disable-next-line no-console
      console.log(`\n==> ${title}`);
    }
    const child = spawn(cmd, cmdArgs, { stdio: 'inherit', shell: false, env: env ?? process.env });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

function runStreaming(cmd, cmdArgs, { title, env } = {}) {
  return new Promise((resolve, reject) => {
    if (title) {
      // eslint-disable-next-line no-console
      console.log(`\n==> ${title}`);
    }
    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, env: env ?? process.env });

    let output = '';
    child.stdout.on('data', (d) => {
      process.stdout.write(d);
      output += d.toString();
    });
    child.stderr.on('data', (d) => {
      process.stderr.write(d);
      output += d.toString();
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve({ code: code ?? 1, output }));
  });
}

async function isPortAvailable(port) {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    // 绑定到 0.0.0.0 以模拟 docker 的端口占用判断（只测 localhost 可能漏掉“外网 IP 已占用”的情况）
    server.listen(port, '0.0.0.0', () => {
      server.close(() => resolve(true));
    });
  });
}

async function pickAvailablePort(preferredPort, { minPort, maxPort } = {}) {
  const min = typeof minPort === 'number' ? minPort : preferredPort;
  const max = typeof maxPort === 'number' ? maxPort : preferredPort + 20;

  for (let port = preferredPort; port <= max; port++) {
    if (port < min) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await isPortAvailable(port)) return port;
  }
  return null;
}

function parsePortConflict(output) {
  const patterns = [
    /Bind for 0\.0\.0\.0:(\d+) failed: port is already allocated/i,
    /listen tcp 0\.0\.0\.0:(\d+): bind: address already in use/i,
    /Ports are not available.*0\.0\.0\.0:(\d+)/i,
  ];
  for (const p of patterns) {
    const m = output.match(p);
    if (m) return Number(m[1]);
  }
  return null;
}

function bumpMappedPort(composeEnv, port) {
  const mappings = [
    { envKey: 'POSTGRES_PORT', min: 5432, max: 5440 },
    { envKey: 'RABBITMQ_PORT', min: 5672, max: 5690 },
    { envKey: 'RABBITMQ_MANAGEMENT_PORT', min: 15672, max: 15690 },
    { envKey: 'BACKEND_HTTP_PORT', min: 4010, max: 4050 },
    { envKey: 'PROVIDER_SIMULATOR_PORT', min: 4020, max: 4060 },
    { envKey: 'FRONTEND_PORT', min: 5173, max: 5190 },
  ];

  for (const m of mappings) {
    const current = Number(composeEnv[m.envKey]);
    if (!Number.isFinite(current)) continue;
    if (current !== port) continue;
    const next = current + 1;
    if (next > m.max) return null;
    composeEnv[m.envKey] = String(next);
    return { envKey: m.envKey, from: current, to: next };
  }
  return null;
}

async function promptMode() {
  if (!process.stdin.isTTY) return 'dev';
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    // eslint-disable-next-line no-console
    console.log('\n请选择启动模式：\n  1) 开发模式（dev）：仅启动依赖(Postgres/RabbitMQ)，其余在本机跑\n  2) 测试模式（test）：全 Docker 启动（依赖+后端+worker+provider+前端）');
    const ans = (await rl.question('请输入 1/2/dev/test（默认 1）：')).trim().toLowerCase();
    if (ans === '2' || ans === 'test') return 'test';
    return 'dev';
  } finally {
    rl.close();
  }
}

function composeFile(mode) {
  return mode === 'test' ? 'compose.test.yaml' : 'compose.dev.yaml';
}

function ensureFiles() {
  const need = ['compose.dev.yaml', 'compose.test.yaml'];
  for (const f of need) {
    if (!existsSync(f)) {
      throw new Error(`缺少文件：${f}（请在仓库根目录执行）`);
    }
  }
}

function printDevNextSteps({ postgresPort, rabbitmqPort, rabbitmqManagementPort }) {
  // eslint-disable-next-line no-console
  console.log(`
\n开发模式（dev）已启动依赖：PostgreSQL + RabbitMQ。
\n下一步（在本机启动应用进程）：

1) 后端 API：
   cd backend
   npm ci
   cp .env.example .env
   # 若你用了非默认端口，请调整 .env 中 DATABASE_URL/RABBITMQ_URL
   # - DATABASE_URL=postgresql://postgres:postgres@localhost:${postgresPort}/compute_engine
   # - RABBITMQ_URL=amqp://guest:guest@localhost:${rabbitmqPort}
   npm run migration:run
   npm run start:dev

2) Worker：
   cd backend
   npm run start:worker

3) Provider Simulator：
   cd providers/examples/provider-simulator
   npm ci
   cp .env.example .env
   npm run dev

4) 前端（Studio + Ops）：
   cd frontend
   npm ci
   cp .env.example .env
   npm run dev

常用地址：
- Backend health: http://localhost:4010/health
- Backend ready:  http://localhost:4010/ready
- Swagger UI:     http://localhost:4010/docs
- RabbitMQ UI:    http://localhost:${rabbitmqManagementPort} (guest/guest)
`);
}

function printTestNextSteps({
  backendHttpPort,
  providerSimulatorPort,
  frontendPort,
  rabbitmqManagementPort,
}) {
  // eslint-disable-next-line no-console
  console.log(`
\n测试模式（test）已全 Docker 启动完成（依赖 + backend + worker + provider + frontend）。
\n常用地址：
- Frontend:       http://localhost:${frontendPort}
- Backend health: http://localhost:${backendHttpPort}/health
- Backend ready:  http://localhost:${backendHttpPort}/ready
- Swagger UI:     http://localhost:${backendHttpPort}/docs
- Provider Sim:   http://localhost:${providerSimulatorPort}
- RabbitMQ UI:    http://localhost:${rabbitmqManagementPort} (guest/guest)

查看日志：
  docker compose -f compose.test.yaml logs -f --tail=200
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    // eslint-disable-next-line no-console
    console.log(`
Prime Engine 启动脚本

用法：
  node scripts/start.mjs              # 交互选择 dev/test
  node scripts/start.mjs --mode dev   # 开发模式（仅依赖 docker）
  node scripts/start.mjs --mode test  # 测试模式（全 docker）

停止/清理：
  node scripts/start.mjs --mode dev --down
  node scripts/start.mjs --mode dev --reset   # down -v（会清空 DB/MQ 数据）
`);
    return;
  }

  ensureFiles();

  const mode = (args.mode ?? (await promptMode())).toLowerCase();
  if (mode !== 'dev' && mode !== 'test') {
    throw new Error(`不支持的 mode：${mode}（仅支持 dev/test）`);
  }

  const file = composeFile(mode);
  const baseArgs = ['compose', '-f', file];
  const composeEnv = { ...process.env };

  // 端口冲突：尽量自动选择可用端口，并通过 compose env 覆盖映射
  const postgresPort =
    (await pickAvailablePort(Number(process.env.POSTGRES_PORT ?? 5432), { maxPort: 5440 })) ?? 5432;
  const rabbitmqPort =
    (await pickAvailablePort(Number(process.env.RABBITMQ_PORT ?? 5672), { maxPort: 5690 })) ?? 5672;
  const rabbitmqManagementPort =
    (await pickAvailablePort(Number(process.env.RABBITMQ_MANAGEMENT_PORT ?? 15672), { maxPort: 15690 })) ??
    15672;

  const backendHttpPort =
    (await pickAvailablePort(Number(process.env.BACKEND_HTTP_PORT ?? 4010), { maxPort: 4050 })) ?? 4010;
  const providerSimulatorPort =
    (await pickAvailablePort(Number(process.env.PROVIDER_SIMULATOR_PORT ?? 4020), { maxPort: 4060 })) ??
    4020;
  const frontendPort =
    (await pickAvailablePort(Number(process.env.FRONTEND_PORT ?? 5173), { maxPort: 5190 })) ?? 5173;

  composeEnv.POSTGRES_PORT = String(postgresPort);
  composeEnv.RABBITMQ_PORT = String(rabbitmqPort);
  composeEnv.RABBITMQ_MANAGEMENT_PORT = String(rabbitmqManagementPort);
  composeEnv.BACKEND_HTTP_PORT = String(backendHttpPort);
  composeEnv.PROVIDER_SIMULATOR_PORT = String(providerSimulatorPort);
  composeEnv.FRONTEND_PORT = String(frontendPort);

  if (args.down) {
    const downArgs = [...baseArgs, 'down'];
    if (args.reset) downArgs.push('-v');
    await run('docker', downArgs, { title: `docker compose down (${mode})`, env: composeEnv });
    return;
  }

  const upArgs = [...baseArgs, 'up'];
  if (args.detach) upArgs.push('-d');

  // docker desktop / wsl 场景下，“端口是否可用”在 host 与 docker engine 之间可能不一致。
  // 因此这里做一次基于错误输出的自动重试：遇到端口占用则把对应映射端口 +1 再试。
  for (let attempt = 0; attempt < 12; attempt++) {
    const suffix = attempt === 0 ? '' : ` (retry ${attempt})`;
    // eslint-disable-next-line no-await-in-loop
    const res = await runStreaming('docker', upArgs, { title: `docker compose up (${mode})${suffix}`, env: composeEnv });
    if (res.code === 0) break;

    const conflictPort = parsePortConflict(res.output);
    if (!conflictPort) {
      throw new Error(`docker compose up 失败（exit=${res.code}）。请检查 Docker 日志输出。`);
    }
    const bumped = bumpMappedPort(composeEnv, conflictPort);
    if (!bumped) {
      throw new Error(
        `端口 ${conflictPort} 被占用，但脚本无法自动选择替代端口。你可以手动设置环境变量（例如 POSTGRES_PORT=5433）后重试。`,
      );
    }

    // eslint-disable-next-line no-console
    console.log(`\n检测到端口冲突：${bumped.envKey}=${bumped.from} → ${bumped.to}，准备重试...`);
  }

  if (mode === 'dev') {
    printDevNextSteps({
      postgresPort: Number(composeEnv.POSTGRES_PORT),
      rabbitmqPort: Number(composeEnv.RABBITMQ_PORT),
      rabbitmqManagementPort: Number(composeEnv.RABBITMQ_MANAGEMENT_PORT),
    });
  } else {
    printTestNextSteps({
      backendHttpPort: Number(composeEnv.BACKEND_HTTP_PORT),
      providerSimulatorPort: Number(composeEnv.PROVIDER_SIMULATOR_PORT),
      frontendPort: Number(composeEnv.FRONTEND_PORT),
      rabbitmqManagementPort: Number(composeEnv.RABBITMQ_MANAGEMENT_PORT),
    });
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`\n启动失败：${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
