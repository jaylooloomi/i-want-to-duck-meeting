import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main, parseArgs, codexSkillDir, MANAGED_BY } from '../../scripts/install.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP = path.join(REPO, 'test', '.tmp');

// Copy the small fixture explicitly across supported Node releases.
function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else fs.copyFileSync(from, to);
  }
}

function fixture(t) {
  fs.mkdirSync(TMP, { recursive: true });
  const root = fs.mkdtempSync(path.join(TMP, 'installer-'));
  t.after(() => {
    assert.ok(!path.relative(TMP, root).startsWith('..'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const repo = path.join(root, "repo O'Neil & $literal %VALUE% 中文");
  copyDirectory(path.join(REPO, 'codex'), path.join(repo, 'codex'));
  fs.mkdirSync(path.join(repo, 'plugin', 'skills', 'meet'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'plugin', 'skills', 'meet', 'SKILL.md.tmpl'), path.join(repo, 'plugin', 'skills', 'meet', 'SKILL.md.tmpl'));
  fs.mkdirSync(path.join(repo, 'bin'));
  fs.writeFileSync(path.join(repo, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(repo, 'bin', 'openmeeting.js'), 'console.log(JSON.stringify(process.argv.slice(2))); process.exit(7);');
  const home = path.join(root, 'home');
  const logs = [];
  const calls = [];
  const deps = { repoRoot: repo, home, env: {}, platform: 'win32', setupAudio:async()=>{}, io: { log: (s) => logs.push(s), error: (s) => logs.push(s) }, runClaude: (args) => {
    calls.push(args);
    if (args.join(' ') === 'plugin list --json') return { status: 0, stdout: JSON.stringify([{ id: 'openmeeting@openmeeting-local', enabled: true }]), stderr: '' };
    return { status: 0, stdout: args[0] === '--version' ? 'test version' : '', stderr: '' };
  } };
  return { root, repo, home, logs, calls, deps, dest: path.join(home, '.codex', 'skills', 'openmeeting') };
}

test('setup options reject missing, unknown or incompatible targets', () => {
  assert.equal(parseArgs([]).target, 'both');
  for (const args of [['--target'], ['--target', '--force'], ['--bogus'], ['--target', 'unknown'], ['--target', 'claude', '--skills-dir', 'x']]) assert.throws(() => parseArgs(args));
  assert.equal(codexSkillDir({ env: { CODEX_HOME: path.join(TMP, 'custom') }, home: TMP }), path.resolve(TMP, 'custom', 'skills', 'openmeeting'));
});

test('Codex-only installs portable source plus data-only local paths without Claude', async (t) => {
  const f = fixture(t);
  assert.equal(await main(['--target', 'codex'], f.deps), 0, f.logs.join('\n'));
  assert.equal(f.calls.length, 0);
  const config = JSON.parse(fs.readFileSync(path.join(f.dest, 'runtime.json'), 'utf8'));
  assert.deepEqual(config, { managedBy: MANAGED_BY, repoRoot: f.repo, nodePath: process.execPath });
  const skill = fs.readFileSync(path.join(f.dest, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\r?\nname: openmeeting\r?\n/);
  assert.ok(!skill.includes('C:/Users/User') && !skill.includes('D:/git/openmeeting'));
  assert.ok(fs.existsSync(path.join(f.dest, 'agents', 'openai.yaml')));
});

test('dry-run has no filesystem or Claude side effects', async (t) => {
  const f = fixture(t);
  assert.equal(await main(['--dry-run'], f.deps), 0);
  assert.equal(fs.existsSync(f.home), false);
  assert.equal(fs.existsSync(path.join(f.repo, 'plugin', 'skills', 'meet', 'SKILL.md')), false);
  assert.equal(f.calls.length, 0);
});

test('default setup prepares audio; skip and dry-run do not; failed preparation leaves integrations untouched',async(t)=>{
  for(const args of [[],['--skip-audio'],['--dry-run']]) {
    const f=fixture(t);let prepared=0;
    assert.equal(await main(args,{...f.deps,setupAudio:async(config)=>{prepared++;assert.equal(config.home,f.repo);}}),0);
    assert.equal(prepared,args.length?0:1);
  }
  const f=fixture(t);
  assert.equal(await main([],{...f.deps,setupAudio:async()=>{throw Error('download unavailable');}}),1);
  assert.equal(fs.existsSync(f.home),false);
  assert.equal(fs.existsSync(path.join(f.repo,'plugin/skills/meet/SKILL.md')),false);
});

test('managed reinstallation repairs known files and supports moving the checkout', async (t) => {
  const f = fixture(t);
  assert.equal(await main(['--target', 'codex'], f.deps), 0);
  const note = path.join(f.dest, 'my-note.txt');
  fs.writeFileSync(note, 'preserve');
  fs.writeFileSync(path.join(f.dest, 'SKILL.md'), 'interrupted old skill');
  const moved = path.join(f.root, 'moved repo');
  copyDirectory(f.repo, moved);
  assert.equal(await main(['--target', 'codex'], { ...f.deps, repoRoot: moved }), 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dest, 'runtime.json'), 'utf8')).repoRoot, moved);
  assert.equal(fs.readFileSync(note, 'utf8'), 'preserve');
  assert.ok(fs.readFileSync(path.join(f.dest, 'SKILL.md'), 'utf8').startsWith('---'));
});

test('unmanaged skills require explicit force; unrelated files are preserved', async (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.dest, { recursive: true });
  fs.writeFileSync(path.join(f.dest, 'SKILL.md'), 'custom skill');
  assert.equal(await main(['--target', 'codex'], f.deps), 1);
  assert.equal(fs.readFileSync(path.join(f.dest, 'SKILL.md'), 'utf8'), 'custom skill');
  assert.equal(await main(['--target', 'codex', '--force'], f.deps), 0);
});

test('missing Claude fails before modifying either integration and explains target selection', async (t) => {
  const f = fixture(t);
  assert.equal(await main([], { ...f.deps, runClaude: () => ({ status: 1 }) }), 1);
  assert.equal(fs.existsSync(f.home), false);
  assert.ok(f.logs.some((s) => s.includes('--target codex')));
});

test('both and Claude-only use the legacy plugin updater and enable the plugin', async (t) => {
  for (const target of ['both', 'claude']) {
    const f = fixture(t);
    assert.equal(await main(['--target', target], f.deps), 0, f.logs.join('\n'));
    assert.ok(f.calls.some((a) => a.join(' ') === 'plugin enable openmeeting@openmeeting-local'));
    assert.ok(fs.existsSync(path.join(f.repo, 'plugin', 'skills', 'meet', 'SKILL.md')));
    assert.equal(fs.existsSync(f.dest), target === 'both');
  }
});

test('already-enabled Claude succeeds despite enable exit code; disabled state fails verification', async (t) => {
  for (const enabled of [true, false]) {
    const f = fixture(t);
    const runClaude = (args) => {
      if (args[1] === 'enable') return { status: 1, stderr: 'already enabled' };
      if (args.join(' ') === 'plugin list --json') return { status: 0, stdout: JSON.stringify([{ id: 'openmeeting@openmeeting-local', enabled }]) };
      return f.deps.runClaude(args);
    };
    assert.equal(await main(['--target', 'claude'], { ...f.deps, runClaude }), enabled ? 0 : 1, f.logs.join('\n'));
  }
});

test('custom skill directory and CODEX_HOME resolve without depending on cwd', async (t) => {
  const f = fixture(t);
  const custom = path.join(f.root, 'custom skills');
  assert.equal(await main(['--target', 'codex', '--skills-dir', custom], { ...f.deps, env: { CODEX_HOME: path.join(f.root, 'unused') } }), 0);
  assert.ok(fs.existsSync(path.join(custom, 'openmeeting', 'runtime.json')));
  assert.equal(fs.existsSync(f.home), false);
});

test('Windows bridge forwards metacharacters and CLI exit codes from another cwd', { skip: process.platform !== 'win32' }, async (t) => {
  const f = fixture(t);
  assert.equal(await main(['--target', 'codex'], f.deps), 0);
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = ['status', 'a & b $literal', '--name', "中文 O'Neil", '--timeout-min', '0'];
  const result = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(f.dest, 'scripts', 'openmeeting.ps1'), ...args], { cwd: f.root, encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.equal(result.status, 7, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), args);
});

test('linked skill files are rejected even with force', { skip: process.platform !== 'win32' }, async (t) => {
  const f = fixture(t);
  assert.equal(await main(['--target', 'codex'], f.deps), 0);
  const elsewhere = path.join(f.root, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.writeFileSync(path.join(elsewhere, 'openmeeting.ps1'), 'do not overwrite');
  fs.rmSync(path.join(f.dest, 'scripts'), { recursive: true });
  fs.symlinkSync(elsewhere, path.join(f.dest, 'scripts'), 'junction');
  assert.equal(await main(['--target', 'codex', '--force'], f.deps), 1);
  assert.equal(fs.readFileSync(path.join(elsewhere, 'openmeeting.ps1'), 'utf8'), 'do not overwrite');
});
