# Aoun Backend — Production Runbook

هذا الدليل مخصص للـPilot الحالي. البنية المدعومة الآن هي **نسخة Web واحدة فقط**، ومعها **Background Worker واحد على الأقل**، وMongoDB Atlas/Replica Set وRedis مُدار. يمنع فحص البيئة تشغيل `WEB_CONCURRENCY>1` حتى إضافة Socket.IO Redis adapter وdistributed cache invalidation وscheduler leadership.

## بوابة ما قبل النشر

1. خذ MongoDB snapshot حديثًا وسجّل وقت النسخة واسمها.
2. تحقق أن الاتصال يتجه إلى قاعدة الإنتاج المقصودة وأنها Replica Set.
3. شغّل من بيئة آمنة تحمل متغيرات Production:

   ```bash
   npm ci
   npm run verify
   npm run db:indexes
   npm run db:indexes:verify
   ```

4. تأكد أن `RUNTIME_TOPOLOGY=single` و`WEB_CONCURRENCY=1` وأن عدد نسخ خدمة Render Web يساوي واحدًا.
5. اضبط `MONGO_INDEXES_REQUIRED=true` و`MONGO_SYNC_INDEXES_ON_STARTUP=false`.
6. اضبط `REDIS_REQUIRED=true` عند الاعتماد على Redis؛ عند فشل الاتصال سيفشل startup بدل الرجوع الصامت إلى MemoryStore.
7. لا تفعّل `PHONE_VERIFICATION_ENABLED=true` قبل ضبط متغيرات Firebase الثلاثة واختبارها.
8. تحقق أن Brevo sender موثّق وأن `CLIENT_URL` و`ALLOWED_ORIGINS` يستخدمان HTTPS الصحيح.
9. أنشئ `OUTBOX_ENCRYPTION_KEY` ثابتًا بـ`openssl rand -hex 32`، واضبط `OUTBOX_WORKER_REQUIRED=true` على خدمتي Web وWorker. لا تغيّر المفتاح قبل تفريغ كل أحداث Outbox المعلقة.
10. شغّل خدمة Background Worker مستقلة بنفس نسخة الكود ومتغيرات البيئة:

   ```text
   Build Command: npm ci && npm run build
   Start Command: npm run worker
   ```

11. عند أول نشر لهذه الدفعة: طبّق الفهارس، انشر Worker وتأكد من heartbeat، ثم انشر Web. استمرار نسخة Worker واحدة على الأقل شرط readiness.

## فحص النشر

بعد النشر:

```text
GET /health/live   -> 200
GET /health/ready  -> 200
```

يجب أن يعرض readiness:

- `checks.database.ready=true`
- `checks.redis.ready=true` عندما يكون Redis مطلوبًا
- `checks.backgroundJobs.ready=true`
- `checks.outboxWorker.ready=true`
- كل jobs تحمل `scheduled=true`

نفّذ بعدها smoke آمنًا:

```bash
npm run perf:smoke
```

ثم اختبر بحساب QA منفصل: تسجيل الدخول، إنشاء/حجز غرض، إشعار، ومحادثة Socket. لا تستخدم حساب مستخدم حقيقي لاختبار عمليات الحذف أو الحظر.

## مؤشرات يجب مراقبتها

- HTTP 5xx و429 وp95 latency.
- `/health/ready` وأسباب `degraded`.
- انقطاع MongoDB أو Redis وإعادة الاتصال.
- `backgroundJobs.*.status=failed` ومدة كل job.
- `checks.outboxWorker.state` وعمر heartbeat.
- عدد أحداث Outbox بحالات `pending` و`dead` وأقدم `availableAt`. وجود `dead` يحتاج تنبيهًا وتحقيقًا قبل إعادة المحاولة اليدوية.
- فشل Brevo وCloudinary وFirebase.
- نمو collections: Notifications وMessages وAdminLogs وReports وOutboxEvents.

## Rollback

1. أوقف استقبال نشر جديد واترك النسخة الحالية إن كانت سليمة.
2. أعد نشر آخر commit معروف أنه ناجح؛ لا تشغّل seed أو `dropDatabase`.
3. أبقِ Worker الجديد عاملاً أثناء rollback إذا كانت النسخة السابقة لا تحتوي Worker، حتى لا تتوقف أحداث Outbox المحفوظة عن التسليم.
4. لا تحذف فهرسًا جديدًا تلقائيًا أثناء rollback. افحص توافق النسخة القديمة معه أولًا.
5. إذا كان الخلل متعلقًا بالبيانات، أوقف الكتابة وخذ snapshot إضافيًا قبل أي restore.
6. restore يتم إلى قاعدة جديدة أولًا، ثم تُفحص العدادات والعلاقات والفهارس قبل تحويل الاتصال.
7. سجّل وقت الاكتشاف، commit المسبب، أثر المستخدمين، وقرار الاستعادة.

## تجربة الاستعادة الدورية

مرة شهريًا للـPilot:

1. استعد آخر snapshot إلى قاعدة اختبار منفصلة.
2. شغّل `npm run db:indexes:verify` عليها.
3. شغّل smoke قراءة، ثم flow كتابة بحسابات QA فقط.
4. سجّل مدة الاستعادة الفعلية كـRTO، وعمر آخر بيانات مستعادة كـRPO.
5. احذف بيئة الاختبار بعد توثيق النتيجة وفق سياسة الاحتفاظ.

## حدود هذه المرحلة

- التوسع الأفقي غير مدعوم وممنوع ببوابة البيئة الحالية.
- Socket presence وsession/settings invalidation والـCron محلية للنسخة الواحدة.
- بريد التفعيل والاستعادة والتنبيهات الإدارية الحرجة يستخدم Durable Outbox مشفّرًا وتسليمًا at-least-once مع retries وحالة `dead`. قد تصل رسالة مكررة نادرًا إذا نجح مزود البريد ثم انقطعت العملية قبل تسجيل الإكمال.
- عمليات خارجية أخرى، مثل تنظيف ملفات Cloudinary بعد حذف السجل، ليست ضمن Outbox الحالي وتحتاج تعويضًا دوريًا قبل إطلاق عام واسع.
- النصوص القانونية وسياسة الاحتفاظ والحذف تحتاج مراجعة قانونية مستقلة قبل تبنٍ مؤسسي.
