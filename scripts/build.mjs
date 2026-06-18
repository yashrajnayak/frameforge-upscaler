import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const files = ['index.html', 'src', 'assets', '.nojekyll'];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of files) {
  const from = path.join(root, file);
  if (!existsSync(from)) {
    throw new Error(`Missing build input: ${file}`);
  }
  await cp(from, path.join(dist, file), { recursive: true });
}

console.log(`Built static site at ${path.relative(root, dist)}`);
