// Tests for spec 5.17: plugin packaging (marketplace.json, plugin.json, SKILL.md template)
// and scripts/install-plugin.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MARKETPLACE_NAME,
  PLUGIN_ID,
  cliCommand,
  renderSkill,
  quoteArg,
  parseArgs,
  installPlugin,
} from '../../scripts/install-plugin.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'install-plugin.js');
const TEMPLATE = path.join(REPO_ROOT, 'plugin', 'skills', 'meet', 'SKILL.md.tmpl');
const SKILL = path.join(REPO_ROOT, 'plugin', 'skills', 'meet', 'SKILL.md');
const BIN_FWD = path.join(REPO_ROOT, 'bin', 'openmeeting.js').replace(/\\/g, '/');

/**
 * Minimal frontmatter parser for the single-line `key: value` subset we use.
 * Double-quoted values are parsed as JSON strings, single-quoted values YAML-style.
 * @param {string} md
 */
function parseFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(m, 'SKILL.md must start with a --- frontmatter block');
  /** @type {Record<string, string>} */
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    assert.ok(kv, `unsupported frontmatter line: ${line}`);
    let value = kv[2].trim();
    if (value.startsWith('"')) value = JSON.parse(value);
    else if (value.startsWith("'")) value = value.slice(1, -1).replace(/''/g, "'");
    else {
      assert.ok(!/: |\s#/.test(value), `plain YAML value would mis-parse: ${line}`);
    }
    fm[kv[1]] = value;
  }
  return { fm, body: md.slice(m[0].length) };
}

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
}

function runNode(args, opts = {}) {
  return spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000, ...opts });
}

function claudeAvailable() {
  const r = spawnSync('claude --version', { shell: true, encoding: 'utf8', timeout: 60_000 });
  return r.status === 0;
}

function runClaude(argString) {
  return spawnSync(`claude ${argString}`, {
    shell: true,
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Manifests
// ---------------------------------------------------------------------------

test('marketplace.json declares openmeeting-local with the ./plugin source', () => {
  const mp = readJson('.claude-plugin/marketplace.json');
  assert.equal(mp.name, 'openmeeting-local');
  assert.equal(mp.name, MARKETPLACE_NAME);
  assert.equal(mp.owner?.name, 'Arthur Wang');
  assert.ok(Array.isArray(mp.plugins) && mp.plugins.length === 1);
  const [p] = mp.plugins;
  assert.equal(p.name, 'openmeeting');
  assert.equal(p.source, './plugin');
  assert.equal(typeof p.description, 'string');
  assert.ok(p.description.length > 10);
});

test('plugin.json has name, version, description and author', () => {
  const pj = readJson('plugin/.claude-plugin/plugin.json');
  assert.equal(pj.name, 'openmeeting');
  assert.equal(pj.version, readJson('package.json').version);assert.match(pj.version,/^\d+\.\d+\.\d+$/);
  assert.equal(typeof pj.description, 'string');
  assert.ok(pj.description.length > 10);
  assert.equal(pj.author?.name, 'Arthur Wang');
  assert.equal(PLUGIN_ID, `${pj.name}@${MARKETPLACE_NAME}`);
});

// ---------------------------------------------------------------------------
// Template + render helpers
// ---------------------------------------------------------------------------

test('SKILL.md.tmpl uses the {{CLI}} placeholder and no other placeholders', () => {
  const tmpl = readFileSync(TEMPLATE, 'utf8');
  assert.ok(tmpl.includes('{{CLI}} join "$ARGUMENTS"'), 'join step must use {{CLI}} join "$ARGUMENTS"');
  const others = [...tmpl.matchAll(/\{\{([^}]*)\}\}/g)].map((m) => m[1]).filter((n) => n !== 'CLI');
  assert.deepEqual(others, []);
});

test('cliCommand quotes the absolute bin path with forward slashes', () => {
  assert.equal(cliCommand('C:\\Users\\Some One\\openmeeting'), 'node "C:/Users/Some One/openmeeting/bin/openmeeting.js"');
  assert.equal(cliCommand(REPO_ROOT), `node "${BIN_FWD}"`);
});

test('renderSkill replaces every {{CLI}} literally (no $-pattern expansion)', () => {
  const out = renderSkill('a {{CLI}} b\n{{CLI}} c', { cli: 'node "D:/x$&y/bin/openmeeting.js"' });
  assert.equal(out, 'a node "D:/x$&y/bin/openmeeting.js" b\nnode "D:/x$&y/bin/openmeeting.js" c');
});

test('renderSkill throws on unknown leftover placeholders', () => {
  assert.throws(() => renderSkill('{{CLI}} {{OTHER}}', { cli: 'node x' }), /OTHER/);
});

test('quoteArg leaves safe args alone and quotes args with spaces/metacharacters', () => {
  assert.equal(quoteArg('openmeeting@openmeeting-local'), 'openmeeting@openmeeting-local');
  assert.equal(quoteArg('D:\\git\\openmeeting'), 'D:\\git\\openmeeting');
  assert.equal(quoteArg('C:\\My Repos\\openmeeting'), '"C:\\My Repos\\openmeeting"');
  assert.equal(quoteArg('a&b'), '"a&b"');
});

test('parseArgs understands --render-only, --dry-run and --help', () => {
  assert.deepEqual(parseArgs([]), { renderOnly: false, dryRun: false, help: false });
  assert.deepEqual(parseArgs(['--render-only']), { renderOnly: true, dryRun: false, help: false });
  assert.deepEqual(parseArgs(['--dry-run']), { renderOnly: false, dryRun: true, help: false });
  assert.deepEqual(parseArgs(['-h']), { renderOnly: false, dryRun: false, help: true });
  assert.throws(() => parseArgs(['--bogus']), /--bogus/);
});

// ---------------------------------------------------------------------------
// --render-only into the real path
// ---------------------------------------------------------------------------

test('install-plugin.js --render-only renders a valid SKILL.md', () => {
  const r = runNode([SCRIPT, '--render-only']);
  assert.equal(r.status, 0, `exit ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.ok(existsSync(SKILL), 'SKILL.md must exist after rendering');

  const md = readFileSync(SKILL, 'utf8');
  assert.ok(!md.includes('{{'), 'no {{ placeholders may remain');
  assert.ok(!md.includes('}}'), 'no }} placeholders may remain');
  assert.ok(md.includes(BIN_FWD), `must contain the absolute bin path ${BIN_FWD}`);
  assert.ok(md.includes(`node "${BIN_FWD}" join "$ARGUMENTS"`));
  assert.ok(!md.includes('\\bin\\openmeeting.js'), 'bin path must use forward slashes');

  const { fm, body } = parseFrontmatter(md);
  assert.equal(fm.name, 'meet');
  assert.equal(fm['argument-hint'], '<meeting-link>');
  assert.match(fm['allowed-tools'], /(^|[\s,])Bash\(node:\*\)($|[\s,])/);
  assert.ok(fm.description && fm.description.length >= 50, 'description must be meaningful');
  assert.ok(fm.description.length <= 1024, `description too long: ${fm.description.length}`);
  for (const trigger of ['meet.google.com', 'Google Meet', '參加會議', '加入會議', '會議記錄', '逐字稿']) {
    assert.ok(fm.description.includes(trigger), `description must mention ${trigger}`);
  }

  // Body must cover the whole workflow.
  for (const needle of [
    'MEETING_ID=', 'MEETING_DIR=', 'run_in_background', '7200000', 'wait <MEETING_ID>',
    'transcript.md', 'summary.md', '會議重點', '決議事項', '待辦事項', '待確認問題',
    'audio.wav', 'setup-stt', 'transcribe <MEETING_ID>', 'ERROR=',
    'signin_required', 'not_found', 'blocked', 'denied', 'lobby_timeout',
    'chrome_not_found', 'chrome_launch_failed', 'join_failed', 'crashed',
    'CHROME_PATH', 'bot.log', 'screens/', 'Admit',
    'leave latest', 'transcript latest', 'doctor', 'login',
  ]) {
    assert.ok(body.includes(needle), `SKILL.md body must mention ${needle}`);
  }
  // Every CLI invocation in the body goes through the rendered absolute command.
  assert.ok(!/(^|[\s`])openmeeting (join|wait|leave|transcript|login|doctor|setup-stt|transcribe)\b/m.test(body),
    'CLI calls must use the rendered node "<abs>/bin/openmeeting.js" command');

  // Guard against accidental Claude Code skill substitutions.
  assert.ok(!/!`/.test(md), 'no !`cmd` dynamic-injection blocks');
  assert.ok(!/\$\d/.test(md), 'no $0/$1 positional substitutions');
  assert.ok(!/\$ARGUMENTS\[/.test(md), 'no indexed $ARGUMENTS');
});

test('the rendered CLI path points at bin/openmeeting.js in this repo', (t) => {
  if (!existsSync(path.join(REPO_ROOT, 'bin', 'openmeeting.js'))) {
    t.skip('bin/openmeeting.js not created yet (implemented by another module)');
    return;
  }
  assert.equal(runNode([SCRIPT, '--render-only']).status, 0);
  const md = readFileSync(SKILL, 'utf8');
  const m = md.match(/node "([^"]+\/bin\/openmeeting\.js)"/);
  assert.ok(m);
  assert.ok(existsSync(m[1]), `${m[1]} must exist`);
});

// ---------------------------------------------------------------------------
// --dry-run and the install decision logic (no real claude calls)
// ---------------------------------------------------------------------------

test('install-plugin.js --dry-run prints the claude commands without running them', () => {
  // An empty PATH guarantees that no real `claude` could be executed.
  const env = { ...process.env, PATH: '', Path: '' };
  const r = runNode([SCRIPT, '--dry-run'], { env });
  assert.equal(r.status, 0, `exit ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  const out = r.stdout;
  assert.match(out, /claude plugin marketplace add \S+/);
  assert.ok(out.includes('claude plugin marketplace update openmeeting-local'));
  assert.ok(out.includes('claude plugin install openmeeting@openmeeting-local'));
  assert.ok(out.includes('claude plugin update openmeeting@openmeeting-local'));
});

/**
 * Fake `claude` runner: records calls and answers from a script of handlers.
 * @param {(args: string[]) => {status?: number, stdout?: string, stderr?: string} | undefined} handler
 */
function fakeRunner(handler) {
  /** @type {string[]} */
  const calls = [];
  const run = (args) => {
    calls.push(args.join(' '));
    const res = handler(args) || {};
    return { status: res.status ?? 0, stdout: res.stdout ?? '', stderr: res.stderr ?? '', error: undefined };
  };
  return { run, calls };
}

const quiet = { log() {}, error() {} };

test('installPlugin: fresh install runs marketplace add then plugin install', async () => {
  let installed = false;
  const skillContent = 'rendered-skill';
  const { run, calls } = fakeRunner((args) => {
    const a = args.join(' ');
    if (a === '--version') return { stdout: '2.1.104 (Claude Code)' };
    if (a.startsWith('plugin marketplace add')) return { stdout: '✔ Successfully added marketplace: openmeeting-local (declared in user settings)' };
    if (a === 'plugin list --json') {
      return { stdout: JSON.stringify(installed ? [{ id: PLUGIN_ID, enabled: true, installPath: '/cache/openmeeting/0.1.0' }] : []) };
    }
    if (a === `plugin install ${PLUGIN_ID}`) { installed = true; return { stdout: `✔ Successfully installed plugin: ${PLUGIN_ID} (scope: user)` }; }
    return { status: 1, stderr: `unexpected: ${a}` };
  });
  const result = await installPlugin({
    repoRoot: REPO_ROOT, run, io: quiet,
    readInstalledSkill: () => skillContent, renderedSkill: skillContent,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(calls, [
    '--version',
    `plugin marketplace add ${REPO_ROOT}`,
    'plugin list --json',
    `plugin install ${PLUGIN_ID}`,
    'plugin list --json',
  ]);
});

test('installPlugin: re-run updates the marketplace and the plugin instead', async () => {
  const skillContent = 'rendered-skill';
  const { run, calls } = fakeRunner((args) => {
    const a = args.join(' ');
    if (a === '--version') return { stdout: '2.1.104 (Claude Code)' };
    if (a.startsWith('plugin marketplace add')) return { stdout: "✔ Marketplace 'openmeeting-local' already on disk — declared in user settings" };
    if (a === 'plugin marketplace update openmeeting-local') return { stdout: '✔ Successfully updated marketplace: openmeeting-local' };
    if (a === 'plugin list --json') return { stdout: JSON.stringify([{ id: PLUGIN_ID, enabled: true, installPath: '/cache/openmeeting/0.1.0' }]) };
    if (a === `plugin update ${PLUGIN_ID}`) return { stdout: 'openmeeting is already at the latest version (0.1.0).' };
    return { status: 1, stderr: `unexpected: ${a}` };
  });
  const result = await installPlugin({
    repoRoot: REPO_ROOT, run, io: quiet,
    readInstalledSkill: () => skillContent, renderedSkill: skillContent,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(calls, [
    '--version',
    `plugin marketplace add ${REPO_ROOT}`,
    'plugin marketplace update openmeeting-local',
    'plugin list --json',
    `plugin update ${PLUGIN_ID}`,
    'plugin list --json',
  ]);
});

test('installPlugin: a failing "already exists" add is treated as existing', async () => {
  let listed = false;
  const { run, calls } = fakeRunner((args) => {
    const a = args.join(' ');
    if (a === '--version') return { stdout: '9.9.9 (Claude Code)' };
    if (a.startsWith('plugin marketplace add')) return { status: 1, stderr: "Marketplace 'openmeeting-local' already exists" };
    if (a === 'plugin marketplace update openmeeting-local') return {};
    // First listing misses it (e.g. other scope), install reports "already installed".
    if (a === 'plugin list --json') {
      const out = listed ? [{ id: PLUGIN_ID, enabled: true, installPath: '/cache/x' }] : [];
      return { stdout: JSON.stringify(out) };
    }
    if (a === `plugin install ${PLUGIN_ID}`) return { stdout: `Plugin "${PLUGIN_ID}" is already installed (scope: user)` };
    if (a === `plugin update ${PLUGIN_ID}`) { listed = true; return {}; }
    return { status: 1, stderr: `unexpected: ${a}` };
  });
  const result = await installPlugin({
    repoRoot: REPO_ROOT, run, io: quiet, readInstalledSkill: () => null, renderedSkill: 'x',
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(calls.includes('plugin marketplace update openmeeting-local'));
  assert.ok(calls.includes(`plugin update ${PLUGIN_ID}`), 'install saying "already installed" must fall back to update');
});

test('installPlugin: a stale cached SKILL.md triggers uninstall + reinstall', async () => {
  let cached = 'old-skill';
  const { run, calls } = fakeRunner((args) => {
    const a = args.join(' ');
    if (a === '--version') return { stdout: '2.1.104 (Claude Code)' };
    if (a.startsWith('plugin marketplace add')) return { stdout: "Marketplace 'openmeeting-local' already on disk" };
    if (a === 'plugin marketplace update openmeeting-local') return {};
    if (a === 'plugin list --json') return { stdout: JSON.stringify([{ id: PLUGIN_ID, enabled: true, installPath: '/cache/x' }]) };
    if (a === `plugin update ${PLUGIN_ID}`) return { stdout: 'already at the latest version (0.1.0).' };
    if (a === `plugin uninstall ${PLUGIN_ID}`) return {};
    if (a === `plugin install ${PLUGIN_ID}`) { cached = 'new-skill'; return {}; }
    return { status: 1, stderr: `unexpected: ${a}` };
  });
  const result = await installPlugin({
    repoRoot: REPO_ROOT, run, io: quiet, readInstalledSkill: () => cached, renderedSkill: 'new-skill',
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const i = calls.indexOf(`plugin uninstall ${PLUGIN_ID}`);
  assert.ok(i > 0, 'must uninstall the stale copy');
  assert.equal(calls[i + 1], `plugin install ${PLUGIN_ID}`);
});

test('installPlugin: missing claude CLI fails cleanly with exit info', async () => {
  const { run, calls } = fakeRunner(() => ({ status: 1, stderr: "'claude' is not recognized" }));
  const result = await installPlugin({ repoRoot: REPO_ROOT, run, io: quiet, readInstalledSkill: () => null, renderedSkill: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'claude_not_found');
  assert.deepEqual(calls, ['--version']);
});

test('installPlugin: a failing install is reported as failure', async () => {
  const { run } = fakeRunner((args) => {
    const a = args.join(' ');
    if (a === '--version') return { stdout: '2.1.104 (Claude Code)' };
    if (a.startsWith('plugin marketplace add')) return {};
    if (a === 'plugin list --json') return { stdout: '[]' };
    if (a === `plugin install ${PLUGIN_ID}`) return { status: 1, stderr: 'Source path does not exist' };
    return { status: 1 };
  });
  const result = await installPlugin({ repoRoot: REPO_ROOT, run, io: quiet, readInstalledSkill: () => null, renderedSkill: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'install_failed');
});

// ---------------------------------------------------------------------------
// Official validator (only when the claude CLI is installed)
// ---------------------------------------------------------------------------

const HAVE_CLAUDE = claudeAvailable();

test('claude plugin validate plugin passes', { skip: !HAVE_CLAUDE && 'claude CLI not available', timeout: 180_000 }, () => {
  // Make sure the rendered SKILL.md exists so the validator sees the real skill.
  runNode([SCRIPT, '--render-only']);
  const r = runClaude('plugin validate plugin');
  const out = `${r.stdout}\n${r.stderr}`;
  assert.equal(r.status, 0, `claude plugin validate plugin failed (exit ${r.status}):\n${out}`);
  assert.ok(!/Validation failed/i.test(out), out);
});

test('claude plugin validate . (marketplace) passes', { skip: !HAVE_CLAUDE && 'claude CLI not available', timeout: 180_000 }, () => {
  const r = runClaude('plugin validate .');
  const out = `${r.stdout}\n${r.stderr}`;
  assert.equal(r.status, 0, `claude plugin validate . failed (exit ${r.status}):\n${out}`);
  assert.ok(!/Validation failed/i.test(out), out);
});
