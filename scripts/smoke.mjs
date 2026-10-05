/**
 * End-to-end verification of a built or packaged app.
 *
 * Launches the app twice with `--smoke-test`:
 *
 *   phase "seed"   boots, loads reddit.com, exercises navigation, verifies the
 *                  security posture, writes a session cookie and a known window
 *                  rectangle, then captures a screenshot.
 *   phase "persist" boots again and proves the cookie and the window rectangle
 *                  survived the restart.
 *
 * Usage:
 *   node scripts/smoke.mjs                       # dev build (electron .)
 *   node scripts/smoke.mjs --exe "release/win-unpacked/Reddit.exe"
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { exe: null, keepProfile: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--exe') args.exe = resolve(argv[++i]);
    else if (arg.startsWith('--exe=')) args.exe = resolve(arg.slice(6));
    else if (arg === '--keep-profile') args.keepProfile = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const userDataDir = mkdtempSync(join(tmpdir(), 'reddit-desktop-smoke-'));
const reportDir = join(root, '.smoke');
const screenshot = join(reportDir, 'window.png');
const token = `token-${Date.now().toString(36)}`;
const BOUNDS = { x: 140, y: 96, width: 1040, height: 720 };

mkdirSync(reportDir, { recursive: true });

async function launch(command, argsList, label) {
  console.log(`\n=== ${label} ===`);
  const child = spawn(command, argsList, {
    cwd: root,
    env: {
      ...process.env,
      SMOKE_TEST: '1',
      // A throwaway profile so the checks never touch a real installation.
      REDDIT_DESKTOP_USER_DATA: userDataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const lines = [];
  const collect = (stream) => {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line.trim().length === 0) continue;
        lines.push(line);
        console.log(`  ${label}| ${line}`);
      }
    });
  };
  collect(child.stdout);
  collect(child.stderr);

  const timer = setTimeout(() => {
    console.error(`${label}: timed out after 4 minutes, killing the app`);
    child.kill('SIGKILL');
  }, 4 * 60 * 1000);

  const code = await new Promise((res, rej) => {
    child.on('error', rej);
    child.on('close', res);
  });
  clearTimeout(timer);

  return { code, lines };
}

function summarise(report) {
  if (!report) return 'no report written';
  const failed = report.checks.filter((check) => !check.ok);
  return failed.length === 0
    ? `all ${report.checks.length} checks passed`
    : `${failed.length} of ${report.checks.length} checks FAILED: ${failed
        .map((check) => `${check.name} (${check.detail})`)
        .join('; ')}`;
}

function readReport(phase) {
  const path = join(reportDir, `${phase}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function main() {
  const exe = args.exe;
  const command = exe ?? (await import('electron')).default;
  const commandArgs = exe
    ? [
        `--smoke-test`,
        `--smoke-phase=seed`,
        `--smoke-report=${join(reportDir, 'seed.json')}`,
        `--smoke-screenshot=${screenshot}`,
        `--smoke-cookie-token=${token}`,
      ]
    : ['.', '--smoke-test', '--smoke-phase=seed', `--smoke-report=${join(reportDir, 'seed.json')}`, `--smoke-screenshot=${screenshot}`, `--smoke-cookie-token=${token}`];

  const seed = await launch(command, commandArgs, 'seed');
  const seedReport = readReport('seed');

  const persistArgs = exe
    ? [
        `--smoke-test`,
        `--smoke-phase=persist`,
        `--smoke-report=${join(reportDir, 'persist.json')}`,
        `--smoke-expect-cookie=1`,
        `--smoke-expect-bounds=${BOUNDS.x},${BOUNDS.y},${BOUNDS.width},${BOUNDS.height}`,
      ]
    : ['.', '--smoke-test', '--smoke-phase=persist', `--smoke-report=${join(reportDir, 'persist.json')}`, '--smoke-expect-cookie=1', `--smoke-expect-bounds=${BOUNDS.x},${BOUNDS.y},${BOUNDS.width},${BOUNDS.height}`];

  const persist = await launch(command, persistArgs, 'persist');
  const persistReport = readReport('persist');

  console.log('\n================ smoke summary ================');
  console.log(`target          : ${exe ?? 'electron . (development build)'}`);
  console.log(`seed            : exit=${seed.code} ${summarise(seedReport)}`);
  console.log(`persist         : exit=${persist.code} ${summarise(persistReport)}`);
  console.log(`screenshot      : ${screenshot}`);
  console.log(`throwaway profile: ${userDataDir}`);

  const ok =
    seed.code === 0 &&
    persist.code === 0 &&
    seedReport?.ok === true &&
    persistReport?.ok === true;

  if (!args.keepProfile) rmSync(userDataDir, { recursive: true, force: true });

  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
