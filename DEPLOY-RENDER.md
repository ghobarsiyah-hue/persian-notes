# راهنمای دیپلوی روی Render — پرشین‌نوت

> **چرا Render؟** پروسهٔ Node دائمی اجرا می‌شود (برخلاف Vercel)، پس علاوه بر
> API، **WebSocket همگام‌سازی یادداشت‌های گروهی هم کار می‌کند**. مهم‌تر:
> در تست شبکهٔ شما، Render **تنها پلتفرمی بود که کاملاً در دسترس بود**
> (Railway/Fly/Netlify/Koyeb/Atlas روی این شبکه بلاک‌اند).

## ۱) معماری

```
Render Web Service (Node دائمی)
  └── npm start → server/dist/index.js   (PORT از متغیر Render)
        ├── Express API روی /api/*
        ├── سرو کلاینت بیلدشده (client/dist) با SPA fallback
        └── WebSocket همگام‌سازی روی /api/collab  ✅
              │
              └── MongoDB  (خارج از Render — به §۲ دقت کنید)
```

کلاینت و API هم‌مبدأ (same-origin) هستند؛ CORS لازم نیست.

## ۲) دیتابیس — نکتهٔ مهم

Render دیگر **دیتابیس Node-friendly رایگان ندارد** (MongoDB addon آن فقط در
پلن‌های پولی است). پس:

- **بهترین راه: MongoDB Atlas رایگان (M0).** مشکل: کنسول Atlas روی شبکهٔ
  فعلی شما بلاک است. اگر WARP/VPN را قطع کنید یا موقتاً از شبکهٔ دیگری
  (موبایل هات‌اسپات) استفاده کنید، ثبت‌نام و ساخت کلاستر چند دقیقه بیشتر
  نمی‌گیرد. بعد از آن دیگر به کنسول نیاز ندارید — connection string یک‌بار
  کافی است.
- **راه دوم (فقط برای تستِ خودِ دیپلوی):** به‌طور موقت `MONGODB_URI` را به یک
  Mongo آزمایشی (مثلاً یک کلاستر دوستی) بدهید. بدون دیتابیس، سرویس بالا
  نمی‌آید (`ALLOW_DB_FALLBACK=false` روی سرور دائمی عمداً است).

## ۳) دیپلوی با Blueprint (ساده‌ترین راه)

1. تغییرات را push کنید (فایل `render.yaml` آماده است):
   ```bash
   git add render.yaml api server/src/app.ts server/src/index.ts scripts/deploy-smoke.mjs DEPLOY-RENDER.md
   git commit -m "deploy: Render blueprint + serverless/api separation"
   git push
   ```
2. در [dashboard.render.com](https://dashboard.render.com) (در دسترس است):
   **New + → Blueprint** → ریپوی `persian-notes` را انتخاب کنید.
   Render خودش سرویس `persian-notes` را از `render.yaml` می‌سازد.
3. بعد از ساخت سرویس: **Environment** → مقدار `MONGODB_URI` را با رشتهٔ
   اتصال Atlas جایگزین کنید:
   `mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/persian-notes`
   (پسورد باید URL-encode شود؛ مثلاً `@` → `%40`). سرویس خودکار redeploy می‌شود.
4. دامنهٔ عمومی: **Settings → Networking** → دامنهٔ رایگان
   `persian-notes.onrender.com` خودکار ساخته می‌شود.

## ۴) متغیرهای محیطی (خودکار از render.yaml)

| متغیر | مقدار | توضیح |
|---|---|---|
| `NODE_VERSION` | `20` | نسخهٔ Node |
| `JWT_SECRET` | تولید خودکار | بدون آن سرور در production بالا نمی‌آید |
| `ALLOW_DB_FALLBACK` | `false` | سرور دائمی نباید دیتابیس محلی بسازد |
| `SEED_ON_START` | `false` | `true` = ساختن کاربر دمو هنگام بوت |
| `MONGODB_URI` | دستی وارد می‌شود | رشتهٔ اتصال Atlas |

## ۵) بررسی بعد از دیپلوی

```bash
curl https://<your-app>.onrender.com/api/health   # {"ok":true,...}
```

سپس در مرورگر: ثبت‌نام → یادداشت جدید → ذخیرهٔ خودکار → ویرایش هم‌زمان دو تب
در یادداشت گروهی = همگام‌سازی زنده ✅

اگر سرویس بالا نیامد: **Logs** در داشبورد Render. شایع‌ترین علت‌ها:
- `MONGODB_URI` اشتباه یا پسورد URL-encode نشده
- نبود دسترسی شبکهٔ Atlas: در Atlas → Network Access → `0.0.0.0/0` اضافه کنید

## ۶) محدودیت‌های پلن رایگان Render

- سرویس بعد از ۱۵ دقیقه بی‌کاری **می‌خوابد**؛ درخواست اولیه ۳۰–۵۰ ثانیه
  طول می‌کشد تا بیدار شود (وب‌سوکت بعد از بیداری وصل می‌شود).
- ماهانه ۷۵۰ ساعت اجرای رایگان (برای یک سرویس کافی است).
- درایو دیسک موقتی است — ولی داده‌ها در MongoDB ذخیره می‌شوند، پس مشکلی نیست.
