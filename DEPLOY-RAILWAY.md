# راهنمای دیپلوی روی Railway — پرشین‌نوت

> **چرا Railway؟** سرور به‌صورت **پروسهٔ دائمی Node** اجرا می‌شود، پس برخلاف
> Vercel، هم `/api` کامل بالا می‌آید و هم **WebSocket همگام‌سازی یادداشت‌های
> گروهی (collab hub) کار می‌کند**. کل اپ (کلاینت + API + WS) در یک سرویس
> مستقر می‌شود — دقیقاً مثل `npm start` لوکال.

## ۱) معماری

```
Railway Service (Docker/Nixpacks، پروسهٔ دائمی)
  └── npm start  →  server/dist/index.js  (PORT از متغیر PORT خود Railway)
        ├── Express API روی /api/*
        ├── سرو کلاینت بیلد‌شده (client/dist) با SPA fallback
        └── WebSocket همگام‌سازی روی /api/collab  ✅
              │
              └── MongoDB (Atlas یا Railway MongoDB)
```

کلاینت و API هم‌مبدأ (same-origin) هستند؛ نیازی به CORS یا proxy نیست.

## ۲) دیتابیس — دو راه

**راه الف (توصیه‌شده): MongoDB Atlas رایگان**
- کلاستر M0 بسازید ([atlas](https://www.mongodb.com/cloud/atlas/register))،
  کاربر دیتابیس بسازید، در Network Access گزینهٔ `0.0.0.0/0` را اضافه کنید
  (Railway خروجی IP ثابت ندارد) و connection string را نگه دارید.

**راه ب: MongoDB داخل خود Railway**
- در پروژهٔ Railway: **+ New → Database → MongoDB**. رشتهٔ اتصال با متغیر
  `MONGODB_URI` به سرویس شما تزریق می‌شود (`railway up` بعد از ساخت دیتابیس،
  این متغیر را خودکار می‌بیند). پلن‌های رایگان محدودیت منبع دارند؛ برای
  تست عالی است.

## ۳) متغیرهای محیطی سرویس

| متغیر | مقدار | الزامی |
|---|---|---|
| `MONGODB_URI` | Atlas یا دیتابیس Railway | ✅ (در راه ب خودکار) |
| `JWT_SECRET` | رشتهٔ تصادفی ۳۲+ کاراکتر (`openssl rand -hex 32`) | ✅ |
| `ALLOW_DB_FALLBACK` | `false` | پیشنهاد |
| `SEED_ON_START` | `false` (`true` = ساختن کاربر دمو هنگام بوت) | اختیاری |
| `AI_PROVIDER` | `local` یا `openai` | اختیاری |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | در صورت `openai` | اختیاری |

`PORT` را تنظیم نکنید — Railway خودش می‌دهد و سرور از همان استفاده می‌کند.

## ۴) روش الف — CLI (توصیه‌شده)

```bash
npm i -g @railway/cli   # یا npx railway
railway login           # مرورگر باز می‌شود (یا: railway login --browserless)
railway init            # ساخت پروژهٔ جدید (یک‌بار)
railway add --database mongodb    # اگر راه ب را انتخاب کردید
railway variables --set "JWT_SECRET=...، MONGODB_URI=..."   # متغیرها
railway up              # بیلد + دیپلوی از همین پوشه
railway domain          # ساخت دامنهٔ عمومی (مثلاً persian-notes.up.railway.app)
```

## ۵) روش ب — از GitHub

1. تغییرات را push کنید.
2. در [railway.app](https://railway.app): **New Project → Deploy from GitHub repo**
   و همین ریپو را انتخاب کنید (Root Directory = `persian-notes`).
3. متغیرهای جدول بالا را در سرویس ست کنید → **Deploy**.
4. **Settings → Networking → Generate Domain** برای دامنهٔ عمومی.

`railway.json` خودش build (`npm install && npm run build -w client -w server`)
و start (`npm start`) و healthcheck (`/api/health`) را می‌دهد.

## ۶) بررسی بعد از دیپلوی

```bash
curl https://<your-app>.up.railway.app/api/health   # {"ok":true,...}
```

سپس در مرورگر: ثبت‌نام → یادداشت جدید → ذخیرهٔ خودکار → (اگر گروه ساختید)
ویرایش هم‌زمان دو تب = همگام‌سازی زنده ✅

اگر سرور بالا نیامد: **Railway → سرویس → Deployments → Logs** — شایع‌ترین
علت‌ها: اشتباه بودن `MONGODB_URI` (پسورد URL-encode نشده) یا نبودن `JWT_SECRET`
(سرور در production بدون آن عمداً بالا نمی‌آید).

## ۷) هزینهٔ تقریبی

پلن **Hobby (۵ دلار/ماه اعتبار)** شامل اجرای دائمی یک سرویس کوچک است؛
اگر `MONGODB_URI` را روی Atlas بگذارید، مصرف Railway فقط compute است و
معمولاً داخل اعتبار پلن رایگان/Hobby می‌ماند. دیتابیس Railway جداگانه
منبع مصرف می‌کند.
