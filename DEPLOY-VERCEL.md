# راهنمای دیپلوی روی Vercel — پرشین‌نوت

> این سند نتیجهٔ آماده‌سازی نسخهٔ ۱.۰ برای اجرا روی Vercel است. هر تغییری در
> معماری دیپلوی باید همین‌جا هم به‌روز شود.

## ۱) معماری دیپلوی

```
مرورگر
  │
  ├── صفحات React (استاتیک) ────► CDN وِرسل   (client/dist)
  └── /api/* ───────────────────► Serverless Function (api/index.mjs)
                                     └── همان Express اپ سرور (server/src/app.ts)
                                              └── MongoDB Atlas
```

- **کلاینت:** خروجی `vite build` (پوشهٔ `client/dist`) به‌صورت استاتیک روی CDN
  سرو می‌شود؛ `vercel.json` مسیرهای SPA (مثل `/notes` و `/editor/:id`) را به
  `index.html` برمی‌گرداند.
- **API:** همهٔ درخواست‌های `/api/*` با rewrite به فانکشن `api/index.mjs`
  می‌روند که **دقیقاً همان اپ Express** را با `serveClient: false` بالا
  می‌آورد (بدون اثر جانبی در بوت؛ `createApp` در `server/src/app.ts`).
- **سرور self-hosted (npm start) دست‌نخورده باقی مانده:** `server/src/index.ts`
  فقط از `createApp` استفاده می‌کند؛ رفتار قبلی (بوت، سید، WebSocket همگام‌سازی،
  خاموشی تمیز) حفظ شده است.

## ۲) پیش‌نیازها

1. **MongoDB Atlas (رایگان):** یک cluster بسازید و connection string را بردارید:
   `mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/persian-notes`
2. **حساب Vercel** (رایگان): [vercel.com/signup](https://vercel.com/signup)

## ۳) متغیرهای محیطی (Vercel → Project → Settings → Environment Variables)

| متغیر | مقدار | الزامی |
|---|---|---|
| `MONGODB_URI` | connection string ی Atlas | ✅ |
| `JWT_SECRET` | رشتهٔ تصادفی بلند (۳۲+ کاراکتر) — مثلاً خروجی `openssl rand -hex 32` | ✅ |
| `ALLOW_DB_FALLBACK` | `false` | پیشنهاد |
| `SEED_ON_START` | `false` (کاربر دمو نمی‌سازد؛ برای دمو `true`) | اختیاری |
| `AI_PROVIDER` | `local` (بدون کلید) یا `openai` | اختیاری |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | اگر `AI_PROVIDER=openai` | اختیاری |
| `CORS_ORIGINS` | معمولاً لازم نیست (همه‌چیز same-origin است) | اختیاری |

> `NODE_ENV` را دستی تنظیم نکنید — وِرسل خودش `production` می‌گذارد و ورودی
> serverless هم قبل از هر import آن را force می‌کند.

## ۴) روش الف — دیپلوی از GitHub (توصیه‌شده)

1. تغییرات را push کنید (ریشهٔ پروژه روی Vercel باید پوشهٔ `persian-notes/` باشد —
   در تنظیمات پروژه، **Root Directory** را `persian-notes` بگذارید).
2. در Vercel: **Add New → Project → Import** همین ریپو.
3. Framework Preset: **Other** (فایل `vercel.json` خودش همه‌چیز را می‌دهد:
   build → `npm run build -w client -w server`، output → `client/dist`).
4. متغیرهای جدول بالا را وارد کنید → **Deploy**.

هر push بعدی به `main` به‌صورت خودکار دیپلوی می‌شود.

## ۵) روش ب — دیپلوی با CLI

```bash
npx vercel login          # یک‌بار: ورود با ایمیل/گیت‌هاب
npx vercel                # دیپلوی preview
npx vercel env add MONGODB_URI    # متغیرها را یک‌بار وارد کنید
npx vercel env add JWT_SECRET
npx vercel --prod         # دیپلوی production
```

## ۶) محدودیت‌های شناخته‌شده روی Vercel

- **همگام‌سازی زندهٔ یادداشت‌های گروهی (WebSocket) کار نمی‌کند.** Hub همگام‌سازی
  (`server/src/collab/hub.ts`) به یک پروسهٔ همیشه‌روشن و upgrade واقعی WS نیاز
  دارد که در مدل serverless وجود ندارد. اثر: ویرایش چندنفرهٔ هم‌زمان با
  presence زنده غیرفعال است؛ **ذخیره‌سازی، تاریخچه، جست‌وجو و بقیهٔ امکانات
  از مسیر REST کامل کار می‌کنند.** اگر همگام‌سازی زنده لازم شد، همگام بخش
  collab را روی یک سرور Node دائمی (Railway/Fly.io/VPS) اجرا کنید.
- **فایل‌سیستم read-only است** — هیچ مسیری فایل نمی‌نویسد (بررسی شده).
- **Cold start:** اولین درخواست بعد از یک بی‌کاری ممکن است ۱–۲ ثانیه طول
  بکشد (اتصال MongoDB). طبیعی است.
- `maxDuration` فانکشن ۶۰ ثانیه است (برای خروجی Word/سید کافی است).

## ۷) بررسی بعد از دیپلوی

```bash
curl https://<your-app>.vercel.app/api/health     # {"ok":true,...}
```

سپس در مرورگر: ثبت‌نام → ساخت یادداشت → ذخیرهٔ خودکار. اگر «اتصال به سرور
برقرار نشد» دیدید، لاگ‌ها را ببینید: **Vercel Dashboard → Project → Logs** —
شایع‌ترین علت، اشتباه بودن `MONGODB_URI` است (پسورد Atlas با کاراکتر خاص باید
URL-encode شود) یا باز نبودن دسترسی شبکهٔ Atlas (Network Access →
`0.0.0.0/0` برای شروع).

## ۸) تست محلیِ معادل دیپلوی (پیش از push)

```bash
npm run build -w client -w server
npm run smoke        # سرور production را با NODE_ENV=production و Mongo در حافظه بالا می‌آورد
```

این اسکریپت (`scripts/deploy-smoke.mjs`) همان چهار مسیر حیاتی دیپلوی را چک
می‌کند: health، ثبت‌نام/JWT، ساخت یادداشت، و SPA fallback.
