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

test('طبقة TypeScript الصارمة تفحص كامل Backend التشغيلي ضمن verify', async () => {
  const [
    packageJson,
    strictConfig,
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
    readFile(path.join(projectRoot, 'tsconfig.strict.json'), 'utf8').then(JSON.parse),
    readFile(path.join(projectRoot, 'utils', 'asyncHandler.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'controllers', 'adminController.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'dtos', 'dtoTypes.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'dtos', 'itemDto.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'repositories', 'repositoryTypes.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'repositories', 'conversationRepository.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'services', 'serviceTypes.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'services', 'donationRequestService.ts'), 'utf8'),
  ]);

  assert.equal(strictConfig.compilerOptions.strict, true);
  assert.equal(strictConfig.compilerOptions.noEmit, true);
  assert.ok(strictConfig.include.includes('*.ts'));
  assert.ok(strictConfig.include.includes('config/**/*.ts'));
  assert.ok(strictConfig.include.includes('controllers/**/*.ts'));
  assert.ok(strictConfig.include.includes('dtos/**/*.ts'));
  assert.ok(strictConfig.include.includes('integrations/**/*.ts'));
  assert.ok(strictConfig.include.includes('jobs/**/*.ts'));
  assert.ok(strictConfig.include.includes('middlewares/**/*.ts'));
  assert.ok(strictConfig.include.includes('models/**/*.ts'));
  assert.ok(strictConfig.include.includes('repositories/**/*.ts'));
  assert.ok(strictConfig.include.includes('routes/**/*.ts'));
  assert.ok(strictConfig.include.includes('scripts/**/*.ts'));
  assert.ok(strictConfig.include.includes('services/**/*.ts'));
  assert.ok(strictConfig.include.includes('socket/**/*.ts'));
  assert.ok(strictConfig.include.includes('utils/**/*.ts'));
  assert.match(packageJson.scripts.verify, /typecheck:strict/);
  assert.match(asyncHandler, /RequestHandler/);
  assert.match(asyncHandler, /export = asyncHandler/);
  assert.match(adminController, /import asyncHandler = require/);
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
