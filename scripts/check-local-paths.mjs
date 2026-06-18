import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const { stdout: trackedStdout } = await exec('git', ['ls-files'], { cwd: process.cwd() });
const { stdout: untrackedStdout } = await exec('git', ['ls-files', '--others', '--exclude-standard'], { cwd: process.cwd() });
const files = Array.from(new Set(
  `${trackedStdout}\n${untrackedStdout}`
    .trim()
    .split('\n')
    .map(file => file.trim())
    .filter(Boolean)
));
const textExtensions = /\.(html|css|js|json|md|yml|yaml|svg|txt|gitignore|nojekyll)$/i;
const absolutePathPattern = /(?:\/Users\/|\/home\/|\/var\/folders\/|C:\\Users\\)/;
const forbiddenSourcePattern = /free-ai-video-upscaler|sb2702/i;
const offenders = [];

for (const file of files) {
  if (!textExtensions.test(file) && !['LICENSE', '.nojekyll', '.gitignore'].includes(file)) continue;
  const content = await readFile(file, 'utf8');
  if (absolutePathPattern.test(content)) offenders.push(`${file}: contains a local absolute path`);
  if (forbiddenSourcePattern.test(content)) offenders.push(`${file}: contains a forbidden project reference`);
}

if (offenders.length > 0) {
  console.error(offenders.join('\n'));
  process.exit(1);
}

console.log('No local paths or forbidden project references found.');
