const test = require('node:test');
const assert = require('node:assert/strict');
const { access, readFile } = require('node:fs/promises');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const escapeRegex = require('../utils/escapeRegex').default;

test('تنظيف البحث يستخدم utility مشتركة تحد الطول وتهرب RegExp', () => {
  assert.equal(escapeRegex('a+b?(c)'), 'a\\+b\\?\\(c\\)');
  assert.equal(escapeRegex('x'.repeat(150)).length, 100);
  assert.equal(escapeRegex(null), '');
});

test('لا تعود تكاملات وملفات الهاتف القديمة إلى نسخة التشغيل', async () => {
  const removedPaths = [
    'dtos/phoneDto.js',
    'integrations/baileys.js',
    'integrations/whatsappService.js',
    'repositories/phoneRepository.js',
    'scripts/seed.js',
    'utils/banCache.js',
  ];

  for (const relativePath of removedPaths) {
    await assert.rejects(access(path.join(projectRoot, relativePath)), { code: 'ENOENT' });
  }
});

test('package.json لا يحمل dependencies غير مستخدمة من المسارات المحذوفة', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(projectRoot, 'package.json'), 'utf8')
  );
  const dependencies = packageJson.dependencies ?? {};

  for (const dependency of [
    '@whiskeysockets/baileys',
    'express-async-handler',
    'jose',
    'multer-storage-cloudinary',
    'nodemailer',
  ]) {
    assert.equal(dependencies[dependency], undefined, `${dependency} يجب ألا يعود دون استخدام فعلي`);
  }
});
