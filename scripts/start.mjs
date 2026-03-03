import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
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

function run(cmd, cmdArgs, { title } = {}) {
  return new Promise((resolve, reject) => {
    if (title) {
      // eslint-disable-next-line no-console
      console.log(`\n==> ${title}`);
    }
    const child = spawn(cmd, cmdArgs, { stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
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

function printDevNextSteps() {
  // eslint-disable-next-line no-console
  console.log(`
\n开发模式（dev）已启动依赖：PostgreSQL + RabbitMQ。
\n下一步（在本机启动应用进程）：

1) 后端 API：
   cd backend
   npm ci
   cp .env.example .env
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
- RabbitMQ UI:    http://localhost:15672 (guest/guest)
`);
}

function printTestNextSteps() {
  // eslint-disable-next-line no-console
  console.log(`
\n测试模式（test）已全 Docker 启动完成（依赖 + backend + worker + provider + frontend）。
\n常用地址：
- Frontend:       http://localhost:5173
- Backend health: http://localhost:4010/health
- Backend ready:  http://localhost:4010/ready
- Swagger UI:     http://localhost:4010/docs
- RabbitMQ UI:    http://localhost:15672 (guest/guest)

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

  if (args.down) {
    const downArgs = [...baseArgs, 'down'];
    if (args.reset) downArgs.push('-v');
    await run('docker', downArgs, { title: `docker compose down (${mode})` });
    return;
  }

  const upArgs = [...baseArgs, 'up'];
  if (args.detach) upArgs.push('-d');
  await run('docker', upArgs, { title: `docker compose up (${mode})` });

  if (mode === 'dev') {
    printDevNextSteps();
  } else {
    printTestNextSteps();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`\n启动失败：${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});

