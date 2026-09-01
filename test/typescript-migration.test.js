const test = require('node:test');
const assert = require('node:assert/strict');
const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const runtimeDirectories = [
  'config',
  'controllers',
  'dtos',
  'integrations',
  'jobs',
  'middlewares',
  'models',
  'repositories',
  'routes',
  'scripts',
  'services',
  'socket',
  'utils',
];

test('مصادر Backend التشغيلية TypeScript وتُبنى إلى dist قبل التشغيل', async () => {
  const [packageJson, tsconfig, ...directoryEntries] = await Promise.all([
    readFile(path.join(projectRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(projectRoot, 'tsconfig.json'), 'utf8').then(JSON.parse),
    ...runtimeDirectories.map((directory) =>
      readdir(path.join(projectRoot, directory), { recursive: true })
    ),
  ]);

  const runtimeFiles = directoryEntries.flat().map(String);
  assert.equal(runtimeFiles.some((file) => file.endsWith('.js')), false);
  assert.equal(runtimeFiles.some((file) => file.endsWith('.ts')), true);
  assert.equal(packageJson.scripts.dev, 'tsx watch server.ts');
  assert.equal(packageJson.scripts.start, 'node dist/server.js');
  assert.match(packageJson.scripts.verify, /typecheck/);
  assert.match(packageJson.scripts.verify, /build/);
  assert.equal(tsconfig.compilerOptions.outDir, 'dist');
  assert.equal(tsconfig.compilerOptions.module, 'Node16');
  await Promise.all([
    readFile(path.join(projectRoot, 'app.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'server.ts'), 'utf8'),
  ]);
});
