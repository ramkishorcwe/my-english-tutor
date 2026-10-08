import { cpSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inlinePreviewProps } from './patch-opennext.mjs';

// Preserve the usual Node deployment while producing Sites' Worker layout.
const root = process.cwd();
const output = path.resolve(root, 'dist');
if (output !== path.join(root, 'dist')) throw new Error('Unexpected output path');
const env = {
  ...process.env,
  PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`,
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_WRITE_LOGS: 'false',
  NEXT_PRIVATE_STANDALONE: 'true',
};
function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('node_modules/next/dist/bin/next', ['build', '--webpack']);
run('node_modules/@opennextjs/cloudflare/dist/cli/index.js', ['build', '--skipNextBuild']);
inlinePreviewProps();
rmSync(output, { recursive: true, force: true });
mkdirSync(path.join(output, 'server'), { recursive: true });
run('node_modules/wrangler/bin/wrangler.js', ['deploy', '--dry-run', '--outdir', 'dist/server']);
const entry = readdirSync(path.join(output, 'server')).find((file) => file === 'worker.js');
if (!entry) throw new Error('Wrangler did not emit worker.js');
renameSync(path.join(output, 'server', entry), path.join(output, 'server', 'index.js'));
cpSync('.open-next/assets', path.join(output, 'client'), { recursive: true });
mkdirSync(path.join(output, '.openai'), { recursive: true });
cpSync('.openai/hosting.json', path.join(output, '.openai/hosting.json'));
