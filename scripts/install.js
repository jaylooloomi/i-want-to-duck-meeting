#!/usr/bin/env node
// Unified, explicit setup. No npm lifecycle hooks and no credentials in generated files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installPlugin, renderSkillFile, runClaude as defaultRunClaude } from './install-plugin.js';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MANAGED_BY = 'openmeeting-installer-v1';
const HELP = `Usage: npm run setup -- [--target both|codex|claude] [--dry-run] [--skills-dir PATH] [--force]

  --target      Default: both. Codex does not require the Claude CLI.
  --skills-dir  Codex skill parent directory; defaults to CODEX_HOME/skills or ~/.codex/skills.
  --dry-run     Show installation destinations without writing files or running Claude.
  --force       Replace known skill files in an existing unmanaged openmeeting directory.

After installation, start a new Codex chat and reload or restart Claude Code.`;

export function parseArgs(argv) {
  const options = { target: 'both', dryRun: false, force: false, help: false, skillsDir: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--target' || arg === '--skills-dir') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      options[arg === '--target' ? 'target' : 'skillsDir'] = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['both', 'codex', 'claude'].includes(options.target)) throw new Error('target must be both, codex or claude');
  if (options.skillsDir && options.target === 'claude') throw new Error('--skills-dir applies only to Codex');
  return options;
}

export function codexSkillDir({ env = process.env, home = os.homedir(), skillsDir } = {}) {
  const parent = skillsDir || path.join(env.CODEX_HOME || path.join(home, '.codex'), 'skills');
  return path.resolve(parent, 'openmeeting');
}

export function planCodex({ repoRoot = REPO_ROOT, targetDir, nodePath = process.execPath }) {
  const source = path.join(repoRoot, 'codex', 'skills', 'openmeeting');
  const files = new Map();
  for (const relative of ['SKILL.md', 'agents/openai.yaml', 'scripts/openmeeting.ps1']) {
    files.set(relative, fs.readFileSync(path.join(source, relative), 'utf8'));
  }
  files.set('runtime.json', `${JSON.stringify({ managedBy: MANAGED_BY, repoRoot: path.resolve(repoRoot), nodePath: path.resolve(nodePath) }, null, 2)}\n`);
  return { targetDir, files };
}

function checkDestination(targetDir, force) {
  if (!fs.existsSync(targetDir)) return;
  if (fs.lstatSync(targetDir).isSymbolicLink()) throw new Error(`Refusing to overwrite a linked skill directory: ${targetDir}`);
  if (!fs.statSync(targetDir).isDirectory()) throw new Error(`Skill destination is not a directory: ${targetDir}`);
  let managed = false;
  try { managed = JSON.parse(fs.readFileSync(path.join(targetDir, 'runtime.json'), 'utf8')).managedBy === MANAGED_BY; } catch { /* unmanaged */ }
  if (!managed && fs.readdirSync(targetDir).length && !force) {
    throw new Error(`Existing skill is not managed by this installer: ${targetDir}. Back it up and use --force to replace its known files.`);
  }
  // Do not follow linked files or parent directories while updating managed files.
  for (const relative of ['SKILL.md', 'runtime.json', 'agents', 'agents/openai.yaml', 'scripts', 'scripts/openmeeting.ps1']) {
    const file = path.join(targetDir, relative);
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error(`Refusing to overwrite a linked skill path: ${file}`);
  }
}

export async function main(argv, deps = {}) {
  const io = deps.io || console;
  const env = deps.env || process.env;
  const platform = deps.platform || process.platform;
  const repoRoot = deps.repoRoot || REPO_ROOT;
  const runClaude = deps.runClaude || defaultRunClaude;
  try {
    const options = parseArgs(argv);
    if (options.help) { io.log(HELP); return 0; }
    if (platform !== 'win32') throw new Error('openmeeting currently requires Windows 10/11. Run setup on the recording computer.');
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22+ is required');
    const codex = options.target !== 'claude';
    const claude = options.target !== 'codex';
    const targetDir = codexSkillDir({ env, home: deps.home || os.homedir(), skillsDir: options.skillsDir });
    const plan = codex ? planCodex({ repoRoot, targetDir, nodePath: deps.nodePath || process.execPath }) : null;
    if (codex) checkDestination(targetDir, options.force);
    const rendered = claude ? renderSkillFile({ repoRoot, write: false }) : null;
    if (options.dryRun) {
      if (plan) io.log(`[dry-run] Codex: ${targetDir}\n${[...plan.files.keys()].join('\n')}`);
      if (rendered) io.log(`[dry-run] Claude Code: ${rendered.skillPath}; register local marketplace and install/update openmeeting`);
      return 0;
    }
    // Check Claude before any writes so a missing optional host does not cause a partial install.
    if (claude && runClaude(['--version']).status !== 0) throw new Error('Claude Code CLI not found. Install it, or use --target codex.');
    if (plan) {
      for (const [relative, content] of plan.files) {
        const file = path.join(targetDir, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) fs.writeFileSync(file, content, 'utf8');
      }
      io.log(`Codex skill installed: ${targetDir}`);
      io.log('Start a new local Codex chat; paste a Meet link or mention $openmeeting.');
    }
    if (rendered) {
      renderSkillFile({ repoRoot });
      const result = await installPlugin({ repoRoot, run: runClaude, io, renderedSkill: rendered.content });
      if (!result.ok) throw new Error(`Claude installation failed (${result.reason}); completed Codex files, if any, remain installed. Rerun setup after fixing the error.`);
      // The legacy installer preserves disabled state; explicit unified setup enables the requested integration.
      runClaude(['plugin', 'enable', 'openmeeting@openmeeting-local']);
      // Claude returns a nonzero exit code when the plugin is already enabled.
      const listed = runClaude(['plugin', 'list', '--json']);
      let active = false;
      try {
        active = listed.status === 0 && JSON.parse(listed.stdout).some((plugin) => plugin.id === 'openmeeting@openmeeting-local' && plugin.enabled === true && !plugin.errors?.length);
      } catch { /* A failed or malformed listing cannot confirm installation. */ }
      if (!active) throw new Error('Claude plugin installed but its enabled state could not be verified. Run claude plugin enable openmeeting@openmeeting-local and claude plugin list --json.');
      io.log('Claude Code plugin installed and enabled. Run /reload-plugins or restart Claude Code.');
    }
    io.log('Run node bin/openmeeting.js doctor. For first login, run login and close the dedicated browser when finished.');
    return 0;
  } catch (error) {
    io.error(String(error.message || error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
