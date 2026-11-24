# استوديو الشطرنج — Chess Analysis Studio

تحليل مبارياتك من chess.com و lichess بمحرك Stockfish 19 الأصلي: دقة وBrilliant/Blunder لكل مباراة، إحصائيات الافتتاحيات بأسماء ECO، أخطاؤك تحت ضغط الوقت، مدرب شخصي حسب تصنيفك، تمارين من أخطائك، وبوتات للتدريب. يعمل على سيرفرك وبياناتك لا تغادره.

## التثبيت بأمر واحد (حاوية LXC أو VM بـ Debian/Ubuntu، كـ root)
```
curl -fsSL https://raw.githubusercontent.com/IPurplel/chess-analysis-studio/main/deploy/bootstrap.sh | bash
```
يثبّت Docker وgit، ينسخ المشروع إلى `/opt/chess-analysis-studio`، يبني الصورة (يحمّل Stockfish الرسمي ويتحقق من بصمته)، ثم يطبع الرابط `http://IP:3000`.

- حاوية LXC على Proxmox: فعّل على المضيف `pct set <ID> --features nesting=1,keyctl=1` ثم أعد تشغيلها قبل التثبيت.
- أسرع على سيرفر ضعيف (صورة جاهزة بدل البناء): `STUDIO_IMAGE=ghcr.io/ipurplel/chess-analysis-studio:latest` قبل الأمر (تأكد أن حزمة الصورة عامة في GitHub).
- **تحديث تلقائي:** المثبّت يفعّل مؤقتًا (systemd) يفحص GitHub كل 10 دقائق؛ عند وجود نسخة جديدة يسحبها ويعيد بناء الحاوية ويشغّلها. إن فشل تشغيل النسخة الجديدة يرجع للسابقة تلقائيًا. بعد كل تحديث يحذف الصور القديمة وكاش البناء الزائد (لا يمس بياناتك ولا صور أخرى على الجهاز). السجل: `/var/log/chess-studio-update.log`. للإيقاف: `systemctl disable --now chess-studio-update.timer` أو ثبّت بـ `AUTO_UPDATE=0`.
- تحديث فوري يدويًا: `bash /opt/chess-analysis-studio/deploy/update.sh` (البيانات محفوظة في volume).
- نسخ احتياطي: `docker run --rm -v chess-analysis-studio_studio-data:/d -v $PWD:/b busybox tar czf /b/studio-backup.tgz -C /d .`
- خلف HTTPS (Caddy/Nginx): ضع `COOKIE_SECURE=1` في بيئة الخدمة.

## الاستخدام
- كل شخص ينشئ **ملفًا** (اسم + رمز أرقام اختياري 4–12). حساباته ومبارياته وتمارينه منفصلة، وكل متصفح له جلسته. ضع رمزًا حتى لا يدخل ملفك غيرك على الشبكة.
- الإعدادات ← أضف حساب chess.com/lichess ← مزامنة. التحليل يبدأ تلقائيًا في الخلفية.
- **Brilliant** تقدير شفاف بالقواعد وليس خوارزمية chess.com نفسها؛ الشروط والعتبات في `packages/core/src/review.ts` وعند تغييرها يعاد تصنيف المخزّن بدون محرك.

## التطوير
```
npm install && npm run build && npm start     # http://localhost:3000
npm test                                      # نواة التصنيف + واجهة الـAPI وعزل المستخدمين
```
المحرك المحلي: ضع Stockfish في `data/bin` أو حدّد `STOCKFISH_PATH`. متغيرات: `ENGINE_WORKERS`، `ANALYSIS_MOVETIME`، `PORT`، `DATA_DIR`.

الترخيص GPL-3.0 (لاعتماد المشروع على Chessground). انظر `NOTICE.md`.
