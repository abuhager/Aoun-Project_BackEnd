# حالة تنفيذ مراجعة Aoun الشاملة

آخر تحديث هندسي: 2026-09-08. هذا الملف يطابق بنود المراجعة
`AOU-001` إلى `AOU-027` مع التنفيذ الحالي في مستودعي Backend وFrontend.

## معنى الحالات

- **مغلق برمجيًا:** التعديل والاختبارات موجودان في الكود.
- **بانتظار تحقق نشر:** التنفيذ موجود، لكن إثباته النهائي يحتاج خدمات/بيانات Production أو Staging.
- **جزئي:** أُغلق الخلل المباشر وبقي برنامج معماري أو تشغيلي أوسع.
- **قرار خارجي:** لا يمكن إغلاقه بتعديل كود فقط.

| البند | الحالة | ما نُفذ | ما بقي قبل إطلاق عام/مؤسسي |
|---|---|---|---|
| AOU-001 | مغلق برمجيًا + تحقق نشر | manifest مشتق من كل schemas، مقارنة الخيارات، preflight للتكرار، CI على Replica Set، وإصلاح عدم إرسال قيم `null` إلى MongoDB | backup ثم `db:indexes` و`db:indexes:verify` على قاعدة الهدف ومراجعة أي duplicates قبل الإنشاء |
| AOU-002 | مغلق برمجيًا | أقفال مستخدم + transactions ومستند `operationVersion` للإنشاء والحجز والعروض والطلب الشهري، مع اختبارات تزامن | تشغيل اختبار حمل على حجم بيانات ممثل |
| AOU-003 | مغلق برمجيًا | Rating وItem وtrust داخل transaction، والإشعار بعد commit مع idempotent replay | fault injection على Replica Set في Staging |
| AOU-004 | مغلق برمجيًا للحقائق الحرجة | أوامر الإدارة وAdminLog داخل transactions، والآثار الخارجية عبر Outbox | اختبار كل أوامر الإدارة بصلاحيات وحالات Production الممثلة |
| AOU-005 | بانتظار تحقق نشر | Socket.IO Redis adapter، WebSocket-only، presence عبر adapter، وحد الرسائل Redis atomic لكل مستخدم | اختبار عقدتين خلف موازن حمل فعليًا: message/typing/forced logout/reconnect |
| AOU-006 | بانتظار تحقق نشر | invalidation موزع للجلسات والإعدادات، TTL fallback قصير، وقفل Redis/leader للـCron | اختبار تغيير settings وlogout بين عقدتين وفشل Redis |
| AOU-007 | مغلق برمجيًا | Durable encrypted Outbox، retries/dead state، Worker مستقل، heartbeat داخل readiness، وCloudinary cleanup | تنبيهات خارجية لأحداث dead ولتأخر heartbeat |
| AOU-008 | مغلق برمجيًا | validation شرطي للبريد/Firebase/Redis/Outbox، عميل بريد واحد بمهلة، وتسليم البريد عبر Outbox | synthetic provider check بحساب QA لدى مزود البريد |
| AOU-009 | جزئي قوي | CI يشغل Replica Set وRedis والفهارس وtransactions وcursor وuniqueness، وFrontend Playwright smoke | full-stack mutating E2E مع Backend/DB معزولين، multi-node Socket، Firefox/WebKit/mobile وaxe |
| AOU-010 | جزئي قوي | runbook، readiness شامل، rollback/restore drill، Prometheus HTTP metrics محمية، SBOM وDependabot | اختيار وربط error tracking/tracing/alerts/SLO، تعريف deployment manifest حسب المنصة، وتنفيذ restore game day فعلي |
| AOU-011 | قرار قانوني خارجي | data map وretention draft وdeletion/export rehearsal وسياسة tombstone هندسية | اعتماد قانوني للبلد، DPA، مدد الاحتفاظ، legal hold، نصوص Privacy/Terms وحقوق الحذف/التصدير |
| AOU-012 | مغلق برمجيًا | optimistic `version` و`expectedVersion` و409 عند التعارض، مع إعادة تحميل الواجهة | لا شيء برمجي مباشر |
| AOU-013 | مغلق برمجيًا | lifecycle `active/deactivating/inactive` وحجز المرجع داخل transaction قبل كتابة Item/Offer | اختبار ضغط create مقابل deactivate في Staging |
| AOU-014 | مغلق برمجيًا | Item tombstone، أرشفة المحادثات، read-only chat، Cloudinary Outbox وorphan audit | اعتماد مدة الاحتفاظ/الحذف النهائي ضمن AOU-011 |
| AOU-015 | مغلق برمجيًا للخلل المحدد | بحث عربي normalized ومفهرس + backfill، waitlist batching، bounds للقوائم، وcursor ثابت للرسائل بـ`createdAt,_id` | `explain('executionStats')` وp95/p99 على dataset ممثل؛ Atlas Search عند تجاوز البحث المحلي سعته |
| AOU-016 | مغلق برمجيًا | URL مصدر الحقيقة لـ`mine/category/location/page` مع اختبار back/reload/share | تنفيذ Playwright المحلي يحتاج browser مثبتًا أو انتظار CI |
| AOU-017 | مغلق برمجيًا | auth state machine تفرق network failure عن invalid session وتحافظ على initialized/session بصورة متسقة | اختبار offline recovery على preview |
| AOU-018 | قرار معماري موثق | ADR يحافظ على nonce CSP الصارمة حاليًا ويحدد تجربة القياس | قياس TTFB/LCP/INP ثم قرار route groups أو hashes؛ لا تُزال الحماية بلا threat model |
| AOU-019 | مغلق برمجيًا | Tajawal/Cairo/Material Symbols وتراخيصها self-hosted، وإزالة Google من CSP/runtime/build | فحص Lighthouse وحجب الشبكة الخارجية على Preview |
| AOU-020 | مغلق برمجيًا | register/verify responses موحدة، dummy comparison، وإرشاد الحساب الموجود عبر Outbox مع rate-limited idempotency | قياس timing distribution خارجيًا ضمن اختبار أمني |
| AOU-021 | مغلق برمجيًا | period موحد على `Asia/Amman`، validation وdry-run/apply backfill | تشغيل check ثم apply على بيانات Production بعد backup |
| AOU-022 | مغلق برمجيًا | GET يعرض effective status بلا mutation؛ الانتقال الفعلي في worker/command | لا شيء برمجي مباشر |
| AOU-023 | جزئي | Socket server generics وعقد JSON مشترك يتحقق منه الطرفان في CI، وتقوية DTOs للمسارات المعدلة | OpenAPI/JSON Schema كامل، generated API types، وتقليل `unknown` تدريجيًا لكل vertical slice |
| AOU-024 | جزئي | توحيد عميل Brevo والtimeout/error codes، Outbox ports، وحدود معمارية موثقة | تقسيم الخدمات الكبيرة وتوحيد كل controller/result styles تدريجيًا مع characterization tests |
| AOU-025 | مغلق كسياسة | Actions مثبتة على commit SHA، Dependabot، audit وCycloneDX SBOM في CI | مراجعة PRs الدورية؛ لا ترقية major تلقائية لـ`rate-limit-redis` |
| AOU-026 | مغلق افتراضيًا بقرار محافظ | evidence منفصلة وtier مشتق؛ الهاتف لا يرفع Level 2 افتراضيًا، ويمكن تفعيله بمتغير واضح | اعتماد Product decision table النهائي وشرحها في UI |
| AOU-027 | مغلق برمجيًا | Web Locks باسم ثابت ينسق refresh بين التبويبات مع fallback | multi-context Playwright لحالة lost/reordered response |

## بوابات الإصدار التي لا يمكن استبدالها بالكود

1. أخذ backup مثبت وقابل للاستعادة قبل أي backfill أو index migration.
2. تشغيل `db:periods:check` و`db:search:check` ومراجعة العدادات قبل `--apply`.
3. تشغيل `db:indexes` ثم `db:indexes:verify` على قاعدة الهدف.
4. نشر Worker أولًا والتأكد من heartbeat، ثم نشر Web.
5. تشغيل smoke وE2E على Preview/Staging، واختبار عقدتين إذا كان topology موزعًا.
6. عدم وصف النظام بأنه جاهز مؤسسيًا قبل اعتماد AOU-011 وربط التنبيهات/الاستعادة الفعلية في AOU-010.

