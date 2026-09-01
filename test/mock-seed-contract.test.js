const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildMockDataset,
  validateDataset,
  assertDatasetIntegrity,
  assertResetAuthorization,
} = require("../scripts/seed-mock-data");

test("Mock seed يطابق كل Schemas ويغطي الحالات التشغيلية الأساسية", async () => {
  const dataset = buildMockDataset(
    "hashed-password-for-schema-validation",
    new Date("2026-08-28T12:00:00.000Z")
  );

  await assert.doesNotReject(() => validateDataset(dataset));
  assert.doesNotThrow(() => assertDatasetIntegrity(dataset));

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(dataset)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => [key, value.length])
    ),
    {
      settings: 1,
      users: 12,
      hubs: 3,
      requests: 5,
      items: 20,
      offers: 6,
      conversations: 3,
      messages: 7,
      notifications: 12,
      ratings: 1,
      reports: 3,
      adminLogs: 5,
    }
  );
});

test("حسابا QA الأساسيان يبقيان بلا معاملات مسبقة", () => {
  const dataset = buildMockDataset("hashed-password");
  const studentId = String(dataset.ids.users.student);
  const donorId = String(dataset.ids.users.donor);

  assert.equal(
    dataset.requests.filter((request) => String(request.requester) === studentId).length,
    0
  );
  assert.equal(
    dataset.items.filter((item) => String(item.donor) === donorId).length,
    0
  );
  assert.equal(
    dataset.offers.filter((offer) => String(offer.donor) === donorId).length,
    0
  );
});

test("كل غرض تجريبي له صورة ثابتة تمثله بدل الصورتين المكررتين", () => {
  const dataset = buildMockDataset("hashed-password");
  const itemImages = dataset.items.map((item) => item.imageUrl);

  assert.equal(itemImages.length, 20);
  assert.equal(new Set(itemImages).size, 20);
  assert.ok(itemImages.every((url) => url.startsWith("https://images.unsplash.com/")));
  assert.equal(dataset.offers[0].imageUrl, dataset.items[2].imageUrl);
});

test("المسح الكامل يحتاج تفعيلًا واسم Database مطابقًا", () => {
  const oldAllow = process.env.ALLOW_MOCK_RESET;
  const oldName = process.env.MOCK_RESET_DATABASE_NAME;

  try {
    delete process.env.ALLOW_MOCK_RESET;
    delete process.env.MOCK_RESET_DATABASE_NAME;
    assert.throws(() => assertResetAuthorization("aoun-demo"), /ALLOW_MOCK_RESET/);

    process.env.ALLOW_MOCK_RESET = "true";
    assert.throws(() => assertResetAuthorization("aoun-demo"), /MOCK_RESET_DATABASE_NAME/);

    process.env.MOCK_RESET_DATABASE_NAME = "different-database";
    assert.throws(() => assertResetAuthorization("aoun-demo"), /رفض المسح/);

    process.env.MOCK_RESET_DATABASE_NAME = "aoun-demo";
    assert.doesNotThrow(() => assertResetAuthorization("aoun-demo"));
  } finally {
    if (oldAllow === undefined) delete process.env.ALLOW_MOCK_RESET;
    else process.env.ALLOW_MOCK_RESET = oldAllow;

    if (oldName === undefined) delete process.env.MOCK_RESET_DATABASE_NAME;
    else process.env.MOCK_RESET_DATABASE_NAME = oldName;
  }
});

test("Seed يستخدم dropDatabase ويعيد الفهارس بعد المسح", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../scripts/seed-mock-data.ts"),
    "utf8"
  );

  assert.match(source, /mongoose\.connection\.dropDatabase\(\)/);
  assert.match(source, /await recreateIndexes\(\)/);
  assert.match(source, /await insertDataset\(dataset\)/);
});
