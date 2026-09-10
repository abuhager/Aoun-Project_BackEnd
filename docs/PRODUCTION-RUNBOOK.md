# Aoun Backend — Production Runbook

يدعم النظام نمطين: `RUNTIME_TOPOLOGY=single` لنسخة Web واحدة، أو
`RUNTIME_TOPOLOGY=distributed` لعدة نسخ Web مع Redis إلزامي. النمط الموزع
يستخدم Socket.IO Redis adapter، WebSocket-only، invalidation موزعًا للجلسات
والإعدادات، وقفل leader لمهام Cron. يشغّل نمط `single` عامل Outbox مدمجًا داخل
Web، بينما يلزم النمط `distributed` خدمة Background Worker مستقلة واحدة على
الأقل. يتطلب كلا النمطين MongoDB Replica Set، ويتطلب النمط الموزع Redis مُدارًا.

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

4. لنسخة واحدة اضبط `RUNTIME_TOPOLOGY=single` و`WEB_CONCURRENCY=1`. للتوسع
   اضبط `RUNTIME_TOPOLOGY=distributed` و`REDIS_REQUIRED=true` واختبر عقدتين.
5. اضبط `MONGO_INDEXES_REQUIRED=true` و`MONGO_SYNC_INDEXES_ON_STARTUP=false`.
6. اضبط `REDIS_REQUIRED=true` عند الاعتماد على Redis؛ عند فشل الاتصال سيفشل startup بدل الرجوع الصامت إلى MemoryStore.
7. قرر سياسة التسجيل: اترك `NEW_USER_DEFAULT_TRUST_LEVEL_2=false` للمستوى 1، أو اضبطها `true` كي تبدأ الحسابات المنشأة بعد التفعيل فقط بالمستوى 2. لا تتجاوز هذه القيمة التحقق من البريد ولا تعدّل الحسابات الموجودة.
8. لا تفعّل `PHONE_VERIFICATION_ENABLED=true` قبل ضبط متغيرات Firebase الثلاثة واختبارها.
9. تحقق أن Brevo sender موثّق وأن `CLIENT_URL` و`ALLOWED_ORIGINS` يستخدمان HTTPS الصحيح.
10. أنشئ `OUTBOX_ENCRYPTION_KEY` ثابتًا بـ`openssl rand -hex 32`، واضبط `OUTBOX_WORKER_REQUIRED=true`. في `single` يعمل العامل داخل Web؛ وفي `distributed` اضبط المفتاح نفسه على Web وWorker المستقل. لا تغيّر المفتاح قبل تفريغ كل أحداث Outbox المعلقة.
11. اضبط `METRICS_ENABLED=true` و`METRICS_TOKEN` عشوائيًا (32 محرفًا على الأقل)، ثم اربط Prometheus أو منصة المراقبة بـ`GET /metrics` مع `Authorization: Bearer <token>`.
12. عند `RUNTIME_TOPOLOGY=single` لا تنشئ خدمة أخرى؛ يبدأ Web عامل Outbox المدمج تلقائيًا. عند `RUNTIME_TOPOLOGY=distributed` شغّل خدمة Background Worker مستقلة بنفس نسخة الكود ومتغيرات البيئة:

   ```text
   Build Command: npm ci && npm run build
   Start Command: npm run worker
   ```

13. عند أول نشر لهذه الدفعة: طبّق الفهارس. في `single` انشر Web ثم تأكد من heartbeat المدمج؛ وفي `distributed` انشر Worker وتأكد من heartbeat ثم انشر Web. استمرار عامل واحد على الأقل شرط readiness.

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
- `aoun_http_requests_total` و`aoun_http_request_duration_ms` من كل Web instance؛ التجميع والتنبيه يتمان في منصة المراقبة.
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

- التوسع الأفقي مدعوم فقط مع `RUNTIME_TOPOLOGY=distributed` وRedis؛ اختبار عقدتين خلف موازن الحمل شرط قبل تفعيله في Production.
- مقاييس `/metrics` محلية لكل process وتحتاج Prometheus/منصة خارجية للتجميع والتنبيه. لا يوجد tracing أو error tracker خارجي مضمن لأن اختيار المزود ووجهته قرار تشغيل وخصوصية.
- بريد التفعيل والاستعادة والتنبيهات الإدارية الحرجة يستخدم Durable Outbox مشفّرًا وتسليمًا at-least-once مع retries وحالة `dead`. قد تصل رسالة مكررة نادرًا إذا نجح مزود البريد ثم انقطعت العملية قبل تسجيل الإكمال.
- تنظيف ملفات Cloudinary بعد tombstone يمر عبر Outbox نفسه؛ يجب مراقبة أحداث `dead` وتشغيل orphan audit دوريًا.
- النصوص القانونية وسياسة الاحتفاظ والحذف تحتاج مراجعة قانونية مستقلة قبل تبنٍ مؤسسي.
