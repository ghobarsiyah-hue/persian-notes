import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useApp } from '@/store/AppProvider';
import { ApiRequestError } from '@/api/client';
import { AuthShell } from '@/components/auth/AuthShell';
import { Button, Spinner, Input } from '@/components/ui';

type Mode = 'login' | 'register';
type FieldName = 'name' | 'username' | 'email' | 'password' | 'confirm';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_-]{3,24}$/;

/** Fast client-side validation (UX layer only — the server re-validates
 *  everything with zod, and its word is the authoritative one). Persian,
 *  plain-language messages; no internal detail ever reaches the user. */
function validate(mode: Mode, v: { name: string; username: string; email: string; password: string; confirm: string }) {
  const errs: Partial<Record<FieldName, string>> = {};
  if (mode === 'register' && v.name.trim().length < 2) errs.name = 'نام باید حداقل ۲ حرف باشد.';
  if (mode === 'register' && v.username.trim() && !USERNAME_RE.test(v.username.trim().toLowerCase()))
    errs.username = 'آیدی باید ۳ تا ۲۴ کاراکتر لاتین، رقم، خط تیره یا زیرخط باشد.';
  if (!v.email.trim()) errs.email = 'ایمیل را وارد کنید.';
  else if (!EMAIL_RE.test(v.email.trim())) errs.email = 'ایمیل واردشده معتبر نیست.';
  if (!v.password) errs.password = 'رمز عبور را وارد کنید.';
  else if (mode === 'register' && v.password.length < 8) errs.password = 'رمز عبور باید حداقل ۸ کاراکتر باشد.';
  if (mode === 'register' && v.confirm !== v.password) errs.confirm = 'تکرار رمز عبور با رمز عبور یکسان نیست.';
  return errs;
}

export default function LoginPage({ initialMode = 'login' }: { initialMode?: Mode }) {
  const { login, register } = useApp();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldErr, setFieldErr] = useState<Partial<Record<FieldName, string>>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [resetHint, setResetHint] = useState(false);

  const switchMode = (next: Mode) => {
    if (busy) return;
    setMode(next);
    setFieldErr({});
    setFormErr(null);
    setResetHint(false);
    navigate(next === 'login' ? '/login' : '/signup', { replace: true });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return; // a request already in flight — never double-submit (§16)
    const errs = validate(mode, { name, username, email, password, confirm });
    setFieldErr(errs);
    setFormErr(null);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(name.trim(), email.trim(), password, username.trim().toLowerCase() || undefined);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError && err.offline) {
        setFormErr('اتصال به سرور برقرار نیست. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.');
      } else {
        /* server messages are already Persian + generic (no enumeration) */
        setFormErr((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const demoLogin = async () => {
    if (busy) return;
    setBusy(true);
    setFormErr(null);
    try {
      await login('demo@pernote.local', 'demo1234');
      navigate('/', { replace: true });
    } catch {
      setFormErr('حساب نمونه یافت نشد. ابتدا دستور npm run seed را اجرا کنید یا حساب جدید بسازید.');
    } finally {
      setBusy(false);
    }
  };

  const errId = (f: FieldName) => `auth-err-${f}`;

  return (
    <AuthShell subtitle={mode === 'login' ? 'وارد حساب خود شوید' : 'حساب جدید بسازید'}>
      <form onSubmit={submit} noValidate className="pn-glass-panel space-y-4 rounded-2xl p-6 shadow-popover" aria-busy={busy}>
        {mode === 'register' && (
          <div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="نام و نام خانوادگی…"
              label="نام"
              required
              dir="rtl"
              autoComplete="name"
              disabled={busy}
              aria-invalid={!!fieldErr.name}
              aria-describedby={fieldErr.name ? errId('name') : undefined}
            />
            {fieldErr.name && (
              <p id={errId('name')} role="alert" className="mt-1 text-xs text-ship dark:text-red-400">
                {fieldErr.name}
              </p>
            )}
          </div>
        )}

        {mode === 'register' && (
          <div>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="مثلاً sara_87…"
              label="آیدی (اختیاری)"
              required={false}
              dir="ltr"
              autoComplete="username"
              disabled={busy}
              aria-invalid={!!fieldErr.username}
              aria-describedby={fieldErr.username ? errId('username') : undefined}
            />
            {fieldErr.username && (
              <p id={errId('username')} role="alert" className="mt-1 text-xs text-ship dark:text-red-400">
                {fieldErr.username}
              </p>
            )}
          </div>
        )}

        <div>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com…"
            label="ایمیل"
            type="email"
            required
            dir="ltr"
            autoComplete="email"
            disabled={busy}
            aria-invalid={!!fieldErr.email}
            aria-describedby={fieldErr.email ? errId('email') : undefined}
          />
          {fieldErr.email && (
            <p id={errId('email')} role="alert" className="mt-1 text-xs text-ship dark:text-red-400">
              {fieldErr.email}
            </p>
          )}
        </div>

        <div>
          <div className="relative">
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              label="رمز عبور"
              type={showPw ? 'text' : 'password'}
              required
              dir="ltr"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              disabled={busy}
              className="pl-10"
              aria-invalid={!!fieldErr.password}
              aria-describedby={fieldErr.password ? errId('password') : undefined}
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              aria-label={showPw ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
              aria-pressed={showPw}
              disabled={busy}
              className="absolute bottom-1.5 left-1.5 flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:bg-gray-100 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-[#222] dark:hover:text-ink-200"
            >
              {showPw ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
            </button>
          </div>
          {fieldErr.password && (
            <p id={errId('password')} role="alert" className="mt-1 text-xs text-ship dark:text-red-400">
              {fieldErr.password}
            </p>
          )}
        </div>

        {mode === 'register' && (
          <div>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              label="تکرار رمز عبور"
              type={showPw ? 'text' : 'password'}
              required
              dir="ltr"
              autoComplete="new-password"
              disabled={busy}
              className="pl-10"
              aria-invalid={!!fieldErr.confirm}
              aria-describedby={fieldErr.confirm ? errId('confirm') : undefined}
            />
            {fieldErr.confirm && (
              <p id={errId('confirm')} role="alert" className="mt-1 text-xs text-ship dark:text-red-400">
                {fieldErr.confirm}
              </p>
            )}
          </div>
        )}

        {formErr && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-ship dark:bg-red-950/40 dark:text-red-400">
            {formErr}
          </p>
        )}

        <Button type="submit" disabled={busy} className="w-full justify-center">
          {busy && <Spinner />}
          {busy ? (mode === 'login' ? 'در حال ورود…' : 'در حال ساخت حساب…') : mode === 'login' ? 'ورود' : 'ساخت حساب'}
        </Button>

        {mode === 'login' && (
          <div className="text-center">
            <button
              type="button"
              onClick={() => setResetHint((s) => !s)}
              disabled={busy}
              className="text-xs text-ink-500 underline underline-offset-4 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-200"
            >
              رمز عبور را فراموش کرده‌اید؟
            </button>
            {resetHint && (
              <p className="mt-2 text-[11px] leading-5 text-ink-500 dark:text-ink-400">
                بازیابی خودکار رمز عبور پس از اتصال سرویس ایمیل فعال می‌شود. تا آن زمان برای بازنشانی رمز با پشتیبانی در تماس باشید.
              </p>
            )}
          </div>
        )}

        <div className="h-px bg-ink-100 dark:bg-ink-800" />

        <p className="text-center text-xs text-ink-500 dark:text-ink-400">
          {mode === 'login' ? 'حساب ندارید؟ ' : 'حساب دارید؟ '}
          <button
            type="button"
            onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
            disabled={busy}
            className="font-medium text-ink-800 underline underline-offset-4 hover:text-ink-900 dark:text-ink-200 dark:hover:text-white"
          >
            {mode === 'login' ? 'ثبت‌نام' : 'ورود'}
          </button>
        </p>

        <div className="text-center">
          <button
            type="button"
            onClick={() => void demoLogin()}
            disabled={busy}
            className="text-xs text-ink-500 underline underline-offset-4 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-300"
          >
            ورود با حساب نمونه (demo@pernote.local)
          </button>
        </div>
      </form>
    </AuthShell>
  );
}
