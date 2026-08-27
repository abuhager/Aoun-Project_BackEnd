# Flow 16 — Cross-Cutting Error Handling & Reusability

## العقد المشترك

كل خطأ HTTP يخرج بالشكل التالي:

```json
{
  "status": "fail",
  "message": "رسالة آمنة للمستخدم",
  "msg": "رسالة آمنة للمستخدم",
  "code": "STABLE_ERROR_CODE",
  "requestId": "request-correlation-id"
}
```

وجود `msg` يحافظ على التوافق مع الشاشات القديمة، و`message` هو الاسم المعتمد للكود الجديد.

## المكونات القابلة لإعادة الاستخدام

- `utils/AppError.js`: الخطأ التشغيلي ومصانع الحالات الشائعة.
- `utils/errorResponse.js`: يحدد status ويبني الاستجابة ويمنع تسريب أخطاء 5xx في production.
- `utils/asyncHandler.js`: يمرر رفض الدوال غير المتزامنة إلى Express error middleware.
- `middlewares/errorHandler.js`: يطبّع أخطاء MongoDB وMulter وCORS ثم يستعمل العقد المركزي.

## قواعد الاستخدام

1. الخدمات ترمي `AppError` ولا تبني استجابة HTTP.
2. الـ controllers لا تكرر `try/catch(next)`؛ تستعمل `asyncHandler`.
3. `code` ثابت وقابل للاستهلاك برمجياً، ولا يعتمد الـFrontend على نص الرسالة.
4. أخطاء البرمجة و5xx لا ترسل الرسالة أو stack في production.
5. `requestId` يعود للواجهة ويُستخدم لربط بلاغ المستخدم بسجل الخادم.
6. لا توضع أسرار أو ملفات `.env` في GitHub.

## أمثلة

```js
throw AppError.notFound('الغرض غير موجود', 'ITEM_NOT_FOUND');
throw AppError.conflict('الطلب منجز مسبقاً', 'REQUEST_ALREADY_FULFILLED');
```

## التحقق

```bash
npm run check
npm test
```

الاختبارات الخاصة بهذا التدفق موجودة في
`test/cross-cutting-error-reusability-flow.test.js`.
