# حدود المعمارية والعقود

- Controllers مسؤولة عن HTTP/cookies فقط.
- DTOs هي حدود الإدخال والإخراج ولا تُرسل Mongoose documents مباشرة للواجهة.
- Services تنفذ use-cases، وRepositories تحصر استعلامات البيانات المتكررة.
- `runMongoTransaction` هو unit-of-work للحقائق متعددة المستندات.
- البريد وحذف الأصول الخارجية يمران عبر Outbox؛ العامل هو adapter الخارجي.
- `contracts/aoun-socket.v1.json` عقد الأحداث القابل للقراءة الآلية، وتتحقق منه
  اختبارات الطرفين. تغييره يتطلب رفع `schemaVersion` وتحديث الطرفين معًا.
- أخطاء الأعمال تستخدم `AppError` مع code ثابت؛ رسائل 5xx الخام لا تصل للعميل.

الخدمات الكبيرة الحالية تُجزّأ تدريجيًا حسب vertical slice. يمنع إضافة client
بريد أو queue مباشر جديد داخل service؛ يضاف port/adapter أو حدث Outbox بدلًا منه.
