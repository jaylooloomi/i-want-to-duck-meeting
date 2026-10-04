// The Windows worker launchers end to end (real CLI, real worker, real headless Chrome against
// the mock Meet): the default WMI launch (worker parented by WmiPrvSE.exe, outside the job
// objects of whoever ran `join`, settings delivered through worker-env.json because WMI gives
// it a fresh environment) and the OPENMEETING_LAUNCHER=spawn opt-out. The data roots have a
// space, CJK and a single quote in them, so every quoting layer (PowerShell literal → WMI
// command line → node argv) is exercised.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMockMeet } from '../mock-meet/server.js';
import { readStatus, isProcessAlive, listMeetings } from '../../src/status.js';
import { encodePowerShell, psQuote, WORKER_ENV_FILE } from '../../src/cli.js';

const WIN = process.platform === 'win32';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO, 'bin', 'openmeeting.js');
const ROOT = path.join(REPO, 'test', '.tmp', 'integ-launcher');
const CODE = 'abc-defg-hij';
/** Speech starts when the bot sets the caption language; the meeting is short. */
const QUICK = { lobbyMs: 300, captionStepMs: 0.3, endAfterMs: 3000 };
const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** One OPENMEETING_HOME per test (a failed test cannot block the next with "already recording"). */
const homeFor = (/** @type {string} */ name) => path.join(ROOT, `${name} 會議 it's`);
const HOMES = ['wmi', 'spawn', 'job-wmi', 'job-spawn'].map(homeFor);

/**
 * The parent environment of `join`: the worker can only get these settings through the env file
 * under WMI. OPENMEETING_LAUNCHER is removed so the default launcher is tested.
 * @param {string} home
 * @param {Record<string, string>} [extra]
 */
function envFor(home, extra = {}) {
  /** @type {Record<string, string|undefined>} */
  const env = {
    ...process.env,
    OPENMEETING_HOME: home,
    OPENMEETING_HEADLESS: '1',
    OPENMEETING_ALLOW_ANY_HOST: '1',
    OPENMEETING_POLL_MS: '300',
    OPENMEETING_BLOCKED_BACKOFF_MS: '100',
    OPENMEETING_NAME: 'Launcher 測試 Bot',
  };
  delete env.OPENMEETING_LAUNCHER;
  return { ...env, ...extra };
}

/** @type {Awaited<ReturnType<typeof startMockMeet>>} */
let mock;

before(async () => {
  if (!WIN) return;
  fs.rmSync(ROOT, { recursive: true, force: true });
  for (const home of HOMES) fs.mkdirSync(home, { recursive: true });
  mock = await startMockMeet();
});

after(async () => {
  if (!WIN) return;
  // never leave a worker (and its Chrome) behind - a WMI-launched one is not our child
  for (const home of HOMES) {
    for (const m of listMeetings(path.join(home, 'meetings'))) {
      const pid = m.status && m.status.pid;
      if (typeof pid === 'number' && isProcessAlive(pid) && pid !== process.pid) {
        try {
          execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
        } catch {
          /* already gone */
        }
      }
    }
  }
  await mock?.close();
  if (process.env.OPENMEETING_KEEP_TMP !== '1') {
    // Chrome may hold its profile for a moment after the worker exits
    for (let i = 0; i < 10; i++) {
      try {
        fs.rmSync(ROOT, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
});

/** `KEY=VALUE` lines → object (first occurrence wins). @param {string} text */
function kvLines(text) {
  /** @type {Record<string, string>} */
  const kv = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !(m[1] in kv)) kv[m[1]] = m[2];
  }
  return kv;
}

/**
 * Run a child process, collecting its output.
 * @param {string} exe @param {string[]} args @param {Record<string, string|undefined>} env @param {number} timeoutMs
 * @returns {Promise<{ code: number|null, pid: number|undefined, stdout: string, stderr: string, kv: Record<string, string> }>}
 */
function run(exe, args, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${path.basename(exe)} ${args.slice(0, 2).join(' ')} timed out\n${stdout}\n${stderr}`));
    }, timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, pid: child.pid, stdout, stderr, kv: kvLines(stdout) });
    });
  });
}

/** The CLI as a child process. @param {string[]} args @param {Record<string, string|undefined>} env */
const cli = (args, env, timeoutMs = 120_000) => run(process.execPath, [BIN, ...args], env, timeoutMs);

/** A Windows PowerShell 5.1 script (no cmd.exe in between); CLIXML progress noise stripped from stderr. */
async function powershell(script, { env = process.env, timeoutMs = 60_000 } = {}) {
  const r = await run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(script)], env, timeoutMs);
  return { ...r, stderr: r.stderr.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 2000) };
}

/** Poll until `pred(status)` holds. */
async function waitForStatus(dir, pred, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const s = readStatus(dir);
    if (s && pred(s)) return s;
    if (Date.now() > end) throw new Error(`status condition not met; last: ${JSON.stringify(s)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Parent pid + parent image name of `pid`, and whether its command line carries --env-file.
 * @param {number} pid
 */
async function processInfo(pid) {
  const r = await powershell([
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"`,
    '$q = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p.ParentProcessId)',
    'Write-Output ("PPID=" + $p.ParentProcessId)',
    'Write-Output ("PARENT=" + $(if ($q) { $q.Name } else { "" }))',
    'Write-Output ("ENVFILE=" + ($p.CommandLine -like "*--env-file=*"))',
  ].join('\r\n'));
  return { ppid: Number(r.kv.PPID), parent: r.kv.PARENT || '', envFileArg: r.kv.ENVFILE || '' };
}

/**
 * Run `openmeeting join <url>` from a PowerShell that first puts itself into a fresh job
 * object, then terminates that job (exit code 7) - like Claude Code stopping the job its tool
 * shells run in. Everything still in the job dies, PowerShell included.
 * @param {string} url @param {Record<string, string|undefined>} env
 */
function joinInsideJobThenTerminateIt(url, env) {
  return powershell([
    'Add-Type -Namespace OmTest -Name Job -MemberDefinition \'[DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr a, string n); [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p); [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateJobObject(IntPtr j, uint c); [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();\'',
    '$job = [OmTest.Job]::CreateJobObject([IntPtr]::Zero, $null)',
    '$ok = [OmTest.Job]::AssignProcessToJobObject($job, [OmTest.Job]::GetCurrentProcess())',
    'Write-Output ("ASSIGNED=" + $ok)',
    'if (-not $ok) { exit 3 }',
    `$null = & ${psQuote(process.execPath)} ${psQuote(BIN)} join ${psQuote(url)}`,
    'Write-Output ("JOINEXIT=" + $LASTEXITCODE)',
    '[Console]::Out.Flush()',
    '[void][OmTest.Job]::TerminateJobObject($job, 7)',
    'Start-Sleep -Seconds 10',
    'exit 0',
  ].join('\r\n'), { env, timeoutMs: 90_000 });
}

test('join (default WMI launcher) → worker under WmiPrvSE.exe, settings via worker-env.json; wait → done', { skip: !WIN, timeout: 240_000 }, async () => {
  const home = homeFor('wmi');
  const env = envFor(home);
  const join = await cli(['join', mock.urlFor(CODE, { scenario: 'happy', ...QUICK })], env, 60_000);
  assert.equal(join.code, 0, `${join.stdout}\n${join.stderr}`);
  assert.equal(join.kv.LAUNCHER, 'wmi', join.stderr);
  const id = join.kv.MEETING_ID;
  const dir = join.kv.MEETING_DIR;
  assert.match(id, /^\d{8}-\d{6}-abc-defg-hij$/);
  assert.equal(dir, path.join(home, 'meetings', id));
  assert.equal(join.kv.DISPLAY_NAME, 'Launcher 測試 Bot');

  const st = readStatus(dir);
  assert.equal(st.launcher, 'wmi');
  assert.equal(typeof st.pid, 'number', 'the worker reported its pid before join returned');
  assert.notEqual(st.pid, join.pid);

  const info = await processInfo(st.pid);
  assert.equal(info.parent.toLowerCase(), 'wmiprvse.exe', `parent of the worker: pid ${info.ppid} ${info.parent}`);
  assert.equal(info.envFileArg, 'True');

  // the parent's OPENMEETING_* settings reached the worker only through the env file
  const envFile = JSON.parse(fs.readFileSync(path.join(dir, WORKER_ENV_FILE), 'utf8'));
  assert.equal(envFile.OPENMEETING_HOME, home);
  assert.equal(envFile.OPENMEETING_HEADLESS, '1');
  assert.equal(envFile.PATH, undefined);

  const wait = await cli(['wait', id, '--poll-ms', '500'], env, 180_000);
  assert.equal(wait.code, 0, `${wait.stdout}\n${wait.stderr}`);
  assert.equal(wait.kv.RESULT, 'done');
  assert.ok(Number(wait.kv.UTTERANCES) >= 1, wait.stdout);
  assert.equal(wait.kv.TRANSCRIPT, path.join(dir, 'transcript.md'));

  // the worker used OPENMEETING_HOME (its Chrome profile lives there, not in the repo)
  assert.ok(fs.existsSync(path.join(home, 'chrome-profile')), 'bot profile under OPENMEETING_HOME');
  assert.match(fs.readFileSync(path.join(dir, 'worker.out'), 'utf8'), new RegExp(`\\[worker\\] pid ${st.pid} started`));
  assert.ok(fs.existsSync(path.join(dir, 'bot.log')));

  // the worker process exits by itself
  await waitForStatus(dir, (s) => !isProcessAlive(s.pid), 20_000);
});

test('OPENMEETING_LAUNCHER=spawn → classic detached spawn (child of join); wait → done', { skip: !WIN, timeout: 240_000 }, async () => {
  const home = homeFor('spawn');
  const env = envFor(home, { OPENMEETING_LAUNCHER: 'spawn' });
  const join = await cli(['join', mock.urlFor(CODE, { scenario: 'happy', ...QUICK })], env, 60_000);
  assert.equal(join.code, 0, `${join.stdout}\n${join.stderr}`);
  assert.equal(join.kv.LAUNCHER, 'spawn');
  const dir = join.kv.MEETING_DIR;
  const st = readStatus(dir);
  assert.equal(st.launcher, 'spawn');
  assert.equal(typeof st.pid, 'number');
  assert.equal(fs.existsSync(path.join(dir, WORKER_ENV_FILE)), false, 'no env file needed: the environment is inherited');

  const info = await processInfo(st.pid);
  assert.equal(info.ppid, join.pid, 'spawned by the join process itself');
  assert.equal(info.envFileArg, 'False');

  const wait = await cli(['wait', join.kv.MEETING_ID, '--poll-ms', '500'], env, 180_000);
  assert.equal(wait.code, 0, `${wait.stdout}\n${wait.stderr}`);
  assert.equal(wait.kv.RESULT, 'done');
  assert.ok(Number(wait.kv.UTTERANCES) >= 1, wait.stdout);
  await waitForStatus(dir, (s) => !isProcessAlive(s.pid), 20_000);
});

test('a WMI-launched worker survives the termination of the job object that ran join', { skip: !WIN, timeout: 240_000 }, async (t) => {
  const home = homeFor('job-wmi');
  const env = envFor(home);
  const r = await joinInsideJobThenTerminateIt(mock.urlFor(CODE, { scenario: 'happy', ...QUICK }), env);
  if (r.kv.ASSIGNED !== 'True') {
    t.skip(`could not put PowerShell into a job object here: ${r.stdout} ${r.stderr}`);
    return;
  }
  assert.equal(r.kv.JOINEXIT, '0', `${r.stdout}\n${r.stderr}`);
  assert.equal(r.code, 7, `the job was terminated with PowerShell in it\n${r.stdout}\n${r.stderr}`);

  const [m] = listMeetings(path.join(home, 'meetings'));
  assert.ok(m, 'join created the meeting');
  const st = readStatus(m.dir);
  assert.equal(st.launcher, 'wmi');
  assert.equal(typeof st.pid, 'number');
  assert.ok(isProcessAlive(st.pid), 'the worker survived the job termination');

  const wait = await cli(['wait', m.id, '--poll-ms', '500'], env, 180_000);
  assert.equal(wait.code, 0, `${wait.stdout}\n${wait.stderr}`);
  assert.equal(wait.kv.RESULT, 'done');
  assert.ok(Number(wait.kv.UTTERANCES) >= 1, wait.stdout);
  await waitForStatus(m.dir, (s) => !isProcessAlive(s.pid), 20_000);
});

test('contrast: a spawn-launched worker dies with the job object that ran join (why WMI is the default)', { skip: !WIN, timeout: 120_000 }, async (t) => {
  const home = homeFor('job-spawn');
  const env = envFor(home, { OPENMEETING_LAUNCHER: 'spawn' });
  const r = await joinInsideJobThenTerminateIt(mock.urlFor(CODE, { scenario: 'happy', ...QUICK, endAfterMs: 600_000 }), env);
  if (r.kv.ASSIGNED !== 'True') {
    t.skip(`could not put PowerShell into a job object here: ${r.stdout} ${r.stderr}`);
    return;
  }
  assert.equal(r.kv.JOINEXIT, '0', `${r.stdout}\n${r.stderr}`);
  assert.equal(r.code, 7);
  const [m] = listMeetings(path.join(home, 'meetings'));
  const st = readStatus(m.dir);
  assert.equal(st.launcher, 'spawn');
  assert.equal(typeof st.pid, 'number');
  await waitForStatus(m.dir, (s) => !isProcessAlive(s.pid), 10_000);
  // `wait` reports the dead worker as crashed
  const wait = await cli(['wait', m.id, '--poll-ms', '200'], env, 60_000);
  assert.equal(wait.code, 3, wait.stdout);
  assert.equal(wait.kv.ERROR, 'crashed');
});
