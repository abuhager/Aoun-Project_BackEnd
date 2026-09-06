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
  assert.equal(packageJson.type, 'module');
  assert.equal(tsconfig.compilerOptions.module, 'NodeNext');
  assert.equal(tsconfig.compilerOptions.moduleResolution, 'NodeNext');
  await Promise.all([
    readFile(path.join(projectRoot, 'app.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'server.ts'), 'utf8'),
  ]);
});

test('طبقة TypeScript الصارمة تفحص كامل Backend التشغيلي ضمن verify', async () => {
  const [
    packageJson,
    tsconfig,
    asyncHandler,
    adminController,
    dtoTypes,
    itemDto,
    repositoryTypes,
    conversationRepository,
    serviceTypes,
    donationRequestService,
  ] = await Promise.all([
    readFile(path.join(projectRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(projectRoot, 'tsconfig.json'), 'utf8').then(JSON.parse),
    readFile(path.join(projectRoot, 'utils', 'asyncHandler.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'controllers', 'adminController.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'dtos', 'dtoTypes.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'dtos', 'itemDto.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'repositories', 'repositoryTypes.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'repositories', 'conversationRepository.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'services', 'serviceTypes.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'services', 'donationRequestService.ts'), 'utf8'),
  ]);

  assert.equal(tsconfig.compilerOptions.strict, true);
  assert.equal(tsconfig.compilerOptions.noImplicitAny, true);
  assert.equal(tsconfig.compilerOptions.useUnknownInCatchVariables, true);
  assert.ok(tsconfig.include.includes('*.ts'));
  assert.ok(tsconfig.include.includes('config/**/*.ts'));
  assert.ok(tsconfig.include.includes('controllers/**/*.ts'));
  assert.ok(tsconfig.include.includes('dtos/**/*.ts'));
  assert.ok(tsconfig.include.includes('integrations/**/*.ts'));
  assert.ok(tsconfig.include.includes('jobs/**/*.ts'));
  assert.ok(tsconfig.include.includes('middlewares/**/*.ts'));
  assert.ok(tsconfig.include.includes('models/**/*.ts'));
  assert.ok(tsconfig.include.includes('repositories/**/*.ts'));
  assert.ok(tsconfig.include.includes('routes/**/*.ts'));
  assert.ok(tsconfig.include.includes('scripts/**/*.ts'));
  assert.ok(tsconfig.include.includes('services/**/*.ts'));
  assert.ok(tsconfig.include.includes('socket/**/*.ts'));
  assert.ok(tsconfig.include.includes('utils/**/*.ts'));
  assert.equal(packageJson.scripts.typecheck, 'tsc --noEmit');
  assert.doesNotMatch(packageJson.scripts.verify, /typecheck:strict/);
  assert.match(asyncHandler, /RequestHandler/);
  assert.match(asyncHandler, /export default asyncHandler/);
  assert.match(adminController, /import asyncHandler from/);
  assert.doesNotMatch(asyncHandler, /\brequire\s*\(|module\.exports|export\s*=/);
  assert.doesNotMatch(adminController, /\brequire\s*\(|module\.exports|import\s+\w+\s*=\s*require/);
  assert.match(dtoTypes, /UnknownRecord/);
  assert.match(dtoTypes, /toPlainRecord = \(value: unknown\)/);
  assert.match(itemDto, /rawItem: unknown/);
  assert.match(repositoryTypes, /EntityId = string \| Types\.ObjectId/);
  assert.match(repositoryTypes, /RepositoryRecord = Record<string, unknown>/);
  assert.match(conversationRepository, /ConversationPair/);
  assert.match(conversationRepository, /error: unknown/);
  assert.match(serviceTypes, /UploadedFile/);
  assert.match(serviceTypes, /getErrorMessage = \(error: unknown/);
  assert.match(donationRequestService, /body: RequestCreateInput/);
  assert.match(donationRequestService, /file\?: UploadedFile/);
});

test('مصدر Backend يستخدم ES import/export بلا CommonJS', async () => {
  const nestedFiles = await Promise.all(
    runtimeDirectories.map(async (directory) => (
      (await readdir(path.join(projectRoot, directory), { recursive: true }))
        .map(String)
        .filter((file) => file.endsWith('.ts'))
        .map((file) => path.join(projectRoot, directory, file))
    ))
  );
  const sourceFiles = [
    path.join(projectRoot, 'app.ts'),
    path.join(projectRoot, 'server.ts'),
    ...nestedFiles.flat(),
  ];

  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, 'utf8');
    assert.doesNotMatch(
      source,
      /\brequire\s*\(|\bmodule\.exports\b|\bexports\.|\bexport\s*=|\bimport\s+\w+\s*=\s*require/,
      `${path.relative(projectRoot, sourceFile)} ما زال يحتوي CommonJS`
    );
  }
});
