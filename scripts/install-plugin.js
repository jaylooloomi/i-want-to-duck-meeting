#!/usr/bin/env node
// Renders plugin/skills/meet/SKILL.md from its template and installs the openmeeting plugin
// into Claude Code from this repo's local marketplace (spec 5.17).
//
//   node scripts/install-plugin.js                # render + marketplace add/update + install/update
//   node scripts/install-plugin.js --render-only  # only render SKILL.md
//   node scripts/install-plugin.js --dry-run      # print the claude commands, run/write nothing
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MARKETPLACE_NAME = 'openmeeting-local';
export const PLUGIN_NAME = 'openmeeting';
export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKILL_REL = ['plugin', 'skills', 'meet'];

/**
 * @param {string} repoRoot
 * @returns {{ templatePath: string, skillPath: string, binPath: string }}
 */
export function skillPaths(repoRoot = REPO_ROOT) {
  const dir = path.join(repoRoot, ...SKILL_REL);
  return {
    templatePath: path.join(dir, 'SKILL.md.tmpl'),
    skillPath: path.join(dir, 'SKILL.md'),
    binPath: path.join(repoRoot, 'bin', 'openmeeting.js'),
  };
}

/**
 * The command Claude runs for every CLI call: `node "<abs repo, forward slashes>/bin/openmeeting.js"`.
 * @param {string} [repoRoot]
 * @returns {string}
 */
export function cliCommand(repoRoot = REPO_ROOT) {
  const bin = `${repoRoot.replace(/\\/g, '/').replace(/\/+$/, '')}/bin/openmeeting.js`;
  return `node "${bin}"`;
}

/**
 * Substitutes `{{CLI}}` literally (no `$&`-style replacement patterns) and refuses leftovers.
 * @param {string} template
 * @param {{ cli: string }} vars
 * @returns {string}
 */
export function renderSkill(template, { cli }) {
  const out = template.split('{{CLI}}').join(cli);
  const left = out.match(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/);
  if (left) throw new Error(`SKILL.md.tmpl has an unknown placeholder {{${left[1]}}}`);
  return out;
}

/**
 * Renders SKILL.md for `repoRoot`. Writes only when the content changed (unless `write` is false).
 * @param {{ repoRoot?: string, write?: boolean }} [opts]
 * @returns {{ skillPath: string, content: string, changed: boolean }}
 */
export function renderSkillFile({ repoRoot = REPO_ROOT, write = true } = {}) {
  const { templatePath, skillPath } = skillPaths(repoRoot);
  const content = renderSkill(readFileSync(templatePath, 'utf8'), { cli: cliCommand(repoRoot) });
  const previous = existsSync(skillPath) ? readFileSync(skillPath, 'utf8') : null;
  const changed = previous !== content;
  if (write && changed) writeFileSync(skillPath, content, 'utf8');
  return { skillPath, content, changed };
}

/**
 * Quotes one argument for a cmd.exe / POSIX shell command line (only when needed).
 * @param {string} arg
 * @returns {string}
 */
export function quoteArg(arg) {
  if (/^[A-Za-z0-9_\-.:\\/@=+,]+$/.test(arg)) return arg;
  return `"${String(arg).replace(/"/g, '""')}"`;
}

/**
 * @param {string[]} argv
 * @returns {{ renderOnly: boolean, dryRun: boolean, help: boolean }}
 */
export function parseArgs(argv) {
  const opts = { renderOnly: false, dryRun: false, help: false };
  for (const a of argv) {
    if (a === '--render-only') opts.renderOnly = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`未知的參數：${a}`);
  }
  return opts;
}

/**
 * @typedef {{ status: number|null, stdout: string, stderr: string, error?: Error }} RunResult
 * @typedef {(args: string[]) => RunResult} ClaudeRunner
 */

/**
 * Runs `claude <args>`. On win32 the `claude` npm/volta shim is a .cmd file, so it goes through
 * the shell as a single, manually quoted command line (avoids Node's DEP0190 args+shell warning).
 * @type {ClaudeRunner}
 */
export function runClaude(args) {
  const opts = /** @type {const} */ ({ encoding: 'utf8', windowsHide: true, timeout: 300_000 });
  const r = process.platform === 'win32'
    ? spawnSync(['claude', ...args.map(quoteArg)].join(' '), { ...opts, shell: true })
    : spawnSync('claude', args, opts);
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

/** @param {RunResult} r */
const outputOf = (r) => `${r.stdout}\n${r.stderr}`.trim();

/**
 * @param {ClaudeRunner} run
 * @returns {{ installPath?: string, errors?: string[], enabled?: boolean } | null | undefined}
 *   the installed entry, null when not installed, undefined when the list could not be read
 */
function findInstalled(run) {
  const r = run(['plugin', 'list', '--json']);
  if (r.status !== 0) return undefined;
  try {
    const start = r.stdout.indexOf('[');
    const list = JSON.parse(r.stdout.slice(start));
    return list.find((p) => p && p.id === PLUGIN_ID) || null;
  } catch {
    return undefined;
  }
}

/** @param {string|undefined} installPath */
function readCachedSkill(installPath) {
  if (!installPath) return null;
  const p = path.join(installPath, ...SKILL_REL.slice(1), 'SKILL.md');
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

/**
 * Registers the local marketplace and installs (or updates) the plugin. Idempotent.
 * All side effects go through `run`, so the decision logic is unit-testable.
 * @param {{
 *   repoRoot?: string,
 *   run?: ClaudeRunner,
 *   io?: { log: (s: string) => void, error: (s: string) => void },
 *   renderedSkill: string,
 *   readInstalledSkill?: (installPath: string|undefined) => string|null,
 * }} opts
 * @returns {Promise<{ ok: boolean, reason?: string, actions: string[] }>}
 */
export async function installPlugin({
  repoRoot = REPO_ROOT,
  run = runClaude,
  io = console,
  renderedSkill,
  readInstalledSkill = readCachedSkill,
}) {
  /** @type {string[]} */
  const actions = [];
  const fail = (reason, msg, r) => {
    io.error(`✗ ${msg}`);
    if (r) io.error(outputOf(r));
    return { ok: false, reason, actions };
  };
  /** @param {string[]} args */
  const step = (args) => {
    actions.push(args.join(' '));
    io.log(`  $ claude ${args.map(quoteArg).join(' ')}`);
    const r = run(args);
    const out = outputOf(r);
    if (out) io.log(out.split(/\r?\n/).map((l) => `    ${l}`).join('\n'));
    return r;
  };

  const ver = run(['--version']);
  if (ver.status !== 0) {
    return fail('claude_not_found',
      '找不到 claude 指令（Claude Code CLI）。請先安裝 Claude Code，或手動執行 --dry-run 印出的指令。');
  }
  io.log(`  使用 Claude Code ${ver.stdout.trim()}`);

  io.log(`[2/3] 註冊本機 marketplace「${MARKETPLACE_NAME}」…`);
  const add = step(['plugin', 'marketplace', 'add', repoRoot]);
  const addOut = outputOf(add);
  if (/already/i.test(addOut)) {
    io.log('  marketplace 已存在，改為更新：');
    const upd = step(['plugin', 'marketplace', 'update', MARKETPLACE_NAME]);
    if (upd.status !== 0) return fail('marketplace_update_failed', 'marketplace 更新失敗。', upd);
  } else if (add.status !== 0) {
    return fail('marketplace_add_failed', 'marketplace 註冊失敗。', add);
  }

  io.log(`[3/3] 安裝外掛 ${PLUGIN_ID}…`);
  const before = findInstalled(run);
  actions.push('plugin list --json');
  const update = () => {
    io.log('  外掛已安裝，改為更新：');
    const u = step(['plugin', 'update', PLUGIN_ID]);
    return u.status === 0 ? null : fail('update_failed', '外掛更新失敗。', u);
  };
  if (before) {
    const err = update();
    if (err) return err;
  } else {
    const inst = step(['plugin', 'install', PLUGIN_ID]);
    if (/already installed/i.test(outputOf(inst))) {
      const err = update();
      if (err) return err;
    } else if (inst.status !== 0) {
      return fail('install_failed', '外掛安裝失敗。', inst);
    }
  }

  // Claude Code copies the plugin into its cache and `plugin update` keeps a same-version copy,
  // so a re-rendered SKILL.md (e.g. the repo moved) needs a reinstall to reach the cache.
  let entry = findInstalled(run);
  actions.push('plugin list --json');
  const cached = entry ? readInstalledSkill(entry.installPath) : null;
  if (cached !== null && cached !== renderedSkill) {
    io.log('  已安裝的 SKILL.md 是舊版，重新安裝外掛：');
    const un = step(['plugin', 'uninstall', PLUGIN_ID]);
    if (un.status !== 0) return fail('reinstall_failed', '移除舊版外掛失敗。', un);
    const inst = step(['plugin', 'install', PLUGIN_ID]);
    if (inst.status !== 0) return fail('install_failed', '外掛安裝失敗。', inst);
    entry = findInstalled(run);
    actions.push('plugin list --json');
  }
  if (entry === null) return fail('install_failed', `安裝後在 claude plugin list 找不到 ${PLUGIN_ID}。`);
  if (entry?.errors?.length) {
    return fail('plugin_errors', `外掛載入有錯誤：\n  ${entry.errors.join('\n  ')}`);
  }
  if (entry && entry.enabled === false) {
    io.log(`  注意：外掛目前是停用狀態，可執行 claude plugin enable ${PLUGIN_ID}`);
  }
  return { ok: true, actions };
}

/**
 * Commands printed by --dry-run (nothing is executed).
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function dryRunCommands(repoRoot = REPO_ROOT) {
  return [
    `claude plugin marketplace add ${quoteArg(repoRoot)}`,
    `  （若顯示已存在）claude plugin marketplace update ${MARKETPLACE_NAME}`,
    `claude plugin install ${PLUGIN_ID}`,
    `  （若已安裝）claude plugin update ${PLUGIN_ID}`,
    `  （若快取中的 SKILL.md 是舊版）claude plugin uninstall ${PLUGIN_ID} && claude plugin install ${PLUGIN_ID}`,
  ];
}

const HELP = `用法：node scripts/install-plugin.js [--render-only | --dry-run]

  （無參數）     產生 SKILL.md，註冊本機 marketplace「${MARKETPLACE_NAME}」，安裝或更新外掛 ${PLUGIN_ID}
  --render-only  只從 SKILL.md.tmpl 產生 plugin/skills/meet/SKILL.md
  --dry-run      只印出會執行的 claude 指令，不執行、不寫檔
`;

/**
 * CLI entry. Returns the process exit code.
 * @param {string[]} argv
 * @param {{ io?: { log: (s: string) => void, error: (s: string) => void }, run?: ClaudeRunner }} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, { io = console, run = runClaude } = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    io.error(String(/** @type {Error} */ (e).message));
    io.error(HELP);
    return 1;
  }
  if (opts.help) {
    io.log(HELP);
    return 0;
  }

  const { binPath } = skillPaths(REPO_ROOT);
  let rendered;
  try {
    rendered = renderSkillFile({ repoRoot: REPO_ROOT, write: !opts.dryRun });
  } catch (e) {
    io.error(`✗ 產生 SKILL.md 失敗：${/** @type {Error} */ (e).message}`);
    return 1;
  }
  const verb = opts.dryRun ? '（dry-run，不寫檔）將產生' : rendered.changed ? '已產生' : '已是最新';
  io.log(`[1/3] SKILL.md ${verb}：${rendered.skillPath}`);
  io.log(`      CLI 指令：${cliCommand(REPO_ROOT)}`);
  if (!existsSync(binPath)) io.log(`      注意：${binPath} 還不存在`);

  if (opts.renderOnly) return 0;

  if (opts.dryRun) {
    io.log('[2/3][3/3] dry-run：以下是會執行的指令（未執行）：');
    for (const c of dryRunCommands(REPO_ROOT)) io.log(`  ${c}`);
    return 0;
  }

  const result = await installPlugin({ repoRoot: REPO_ROOT, run, io, renderedSkill: rendered.content });
  if (!result.ok) {
    io.error('安裝未完成。也可以手動執行：');
    for (const c of dryRunCommands(REPO_ROOT)) io.error(`  ${c}`);
    return 1;
  }
  io.log('');
  io.log('✔ 完成！請重新啟動 Claude Code（或在工作階段中執行 /reload-plugins），');
  io.log('  然後輸入：/openmeeting:meet <Google Meet 連結>');
  io.log('  （選用）先執行 node bin/openmeeting.js login 讓機器人登入專用 Google 帳號；');
  io.log('  （選用）執行 node bin/openmeeting.js setup-stt 安裝離線語音辨識備援。');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
