const { readdirSync, statSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const sourceRoots = [
  'app.js',
  'server.js',
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
  'test',
  'utils',
];

const isJavaScriptFile = (filePath) => /\.(?:cjs|js|mjs)$/.test(filePath);

const collectFiles = (target) => {
  const absoluteTarget = path.join(projectRoot, target);
  const stats = statSync(absoluteTarget);
  if (stats.isFile()) return isJavaScriptFile(absoluteTarget) ? [absoluteTarget] : [];

  return readdirSync(absoluteTarget, { withFileTypes: true }).flatMap((entry) => {
    const childTarget = path.join(target, entry.name);
    return entry.isDirectory()
      ? collectFiles(childTarget)
      : (isJavaScriptFile(entry.name) ? [path.join(projectRoot, childTarget)] : []);
  });
};

const files = sourceRoots.flatMap(collectFiles).sort();
const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    failures.push({ file: path.relative(projectRoot, file), output: result.stderr || result.stdout });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\n[syntax] ${failure.file}\n${failure.output.trim()}`);
  }
  process.exitCode = 1;
} else {
  console.log(`[syntax] تم فحص ${files.length} ملف JavaScript بنجاح.`);
}
