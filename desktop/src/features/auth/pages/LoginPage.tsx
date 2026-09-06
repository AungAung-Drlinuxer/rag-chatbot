import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  LogIn,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useBranding } from "@/app/useBranding";
import { healthPing } from "@/features/auth/api";

type Props = {
  loginUser: string;
  setLoginUser: (v: string) => void;
  loginPass: string;
  setLoginPass: (v: string) => void;
  loginErr: string;
  onSubmit: (e: FormEvent) => void;
};

export default function Login({
  loginUser,
  setLoginUser,
  loginPass,
  setLoginPass,
  loginErr,
  onSubmit,
}: Props) {
  const [showPass, setShowPass] = useState(false);
  const branding = useBranding();
  const [backendUp, setBackendUp] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;

    healthPing().then((ok) => {
      if (mounted) setBackendUp(ok);
    });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--background)] text-slate-900 dark:bg-[#0b0d10] dark:text-slate-100">
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_460px] xl:grid-cols-[minmax(0,1fr)_520px]">
        {/* =========================================================
            LEFT BRAND PANEL
        ========================================================= */}
        <section className="relative hidden flex-col overflow-hidden border-r bg-white lg:flex dark:border-slate-800 dark:bg-[#101318]">
          {/* subtle background decoration */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -left-32 top-20 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />
            <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-blue-500/5 blur-3xl" />

            <div
              className="absolute inset-0 opacity-[0.035]"
              style={{
                backgroundImage:
                  "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
                backgroundSize: "42px 42px",
              }}
            />
          </div>

          <div className="relative flex min-h-screen w-full flex-col justify-between gap-6 px-12 py-8 xl:px-16">
            {/* Brand — matches sidebar (v0.21.31) */}
            <div className="flex items-center gap-3">
              {branding.logo ? (
                <img src={branding.logo} alt="Company logo"
                  className="size-11 shrink-0 rounded-full object-contain shadow-[0_4px_12px_rgba(37,99,235,0.35)]" />
              ) : (
                <div className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--brand-logo)] text-[13px] font-extrabold tracking-tight text-white shadow-[0_4px_12px_rgba(37,99,235,0.35)]">
                  ITH
                </div>
              )}

              <div>
                <div className="text-sm font-bold tracking-tight">
                  {branding.appName || "IT Help Chatbot"}
                </div>
              </div>
            </div>

            {/* Main message */}
            <div className="w-full">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-white/80 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/70">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Internal IT platform
              </div>

              <h1 className="text-3xl font-semibold leading-[1.08] tracking-tight sm:text-4xl xl:text-5xl">
                Find the right
                <br />
                <span className="text-primary">IT answer faster.</span>
              </h1>

              <p className="mt-4 text-sm leading-6 text-muted-foreground sm:mt-6 sm:text-base sm:leading-7">
                Search your internal knowledge base, get grounded answers,
                verify the source, and escalate to IT support when additional
                help is needed.
              </p>

              {/* Illustration (v0.21.100) — sits between the headline and the
                  capability cards. v0.21.100 improvements:
                  - aspect-ratio 2.5/1 so ANY source resolution (1280/1920/4K)
                    renders with the same framed height — no layout shift on load
                  - width: min(100%, 680px) — slightly larger on wide screens
                  - width/height attributes set -> browser reserves space before
                    the file downloads (no CLS), and retina screens stay sharp
                  - fetchpriority=high + decoding async for faster login paint */}
              <div className="my-4 flex max-h-[420px] w-full shrink-0 items-center justify-center px-1 sm:px-2">
                <img
                  src="/login-illustration.jpg"
                  width={1280}
                  height={512}
                  alt="IT Help assistant illustration — search IT knowledge, verify sources, escalate if needed"
                  className="h-auto w-full max-w-[680px] rounded-2xl object-contain shadow-md select-none pointer-events-none"
                  style={{
                    aspectRatio: "2.5 / 1",
                    maxHeight: "min(42vh, 400px)",
                    width: "min(100%, 680px)",
                  }}
                  fetchPriority="high"
                  decoding="async"
                  draggable={false}
                />
              </div>

              {/* Product capabilities */}
              <div className="mt-4 grid w-full max-w-3xl gap-3 sm:grid-cols-3">
                <FeatureCard
                  title="Grounded"
                  description="Answers use internal knowledge."
                />

                <FeatureCard
                  title="Traceable"
                  description="Sources remain visible."
                />

                <FeatureCard
                  title="Actionable"
                  description="Escalate when needed."
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span>Internal IT Service</span>
              <span className="size-1 rounded-full bg-slate-300 dark:bg-slate-700" />
              <span>RBAC protected</span>
              <span className="size-1 rounded-full bg-slate-300 dark:bg-slate-700" />
              <span>Secure access</span>
            </div>
          </div>
        </section>

        {/* =========================================================
            RIGHT LOGIN PANEL
        ========================================================= */}
        <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-5 py-10 dark:bg-[#0b0d10] sm:px-8">
          <div className="w-full max-w-[400px]">
            {/* Mobile brand */}
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-[#4338ca] via-[#7c3aed] to-[#6366f1] text-sm font-extrabold text-white shadow-[0_4px_12px_rgba(99,102,241,0.35)]">
                i
              </div>

              <div>
                <div className="text-sm font-semibold">IT Help</div>

                <div className="text-xs text-muted-foreground">
                  Enterprise Knowledge Assistant
                </div>
              </div>
            </div>

            {/* Login card */}
            <div className="rounded-3xl border bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-[#11151b] dark:shadow-none sm:p-6">
              {/* Heading */}
              <div className="mb-8">
                <div className="mb-4 grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <LockKeyhole className="size-5" />
                </div>

                <h2 className="text-2xl font-semibold tracking-tight">
                  Welcome back
                </h2>

                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Sign in with your corporate account to access the IT
                  knowledge assistant.
                </p>
              </div>

              <form onSubmit={onSubmit} className="space-y-5">
                {/* Username */}
                <div>
                  <label
                    htmlFor="login-username"
                    className="mb-2 block text-sm font-medium"
                  >
                    Username
                  </label>

                  <div className="relative">
                    <UserRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

                    <input
                      id="login-username"
                      name="username"
                      type="text"
                      placeholder="Corporate username"
                      autoComplete="username"
                      autoFocus
                      value={loginUser}
                      onChange={(e) => setLoginUser(e.target.value)}
                      className="h-12 w-full rounded-xl border bg-background pl-11 pr-3 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-4 focus:ring-primary/10"
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label
                      htmlFor="login-password"
                      className="block text-sm font-medium"
                    >
                      Password
                    </label>
                  </div>

                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

                    <input
                      id="login-password"
                      name="password"
                      type={showPass ? "text" : "password"}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      value={loginPass}
                      onChange={(e) => setLoginPass(e.target.value)}
                      className="h-12 w-full rounded-xl border bg-background px-11 pr-12 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-4 focus:ring-primary/10"
                    />

                    <button
                      type="button"
                      aria-label={showPass ? "Hide password" : "Show password"}
                      onClick={() => setShowPass((v) => !v)}
                      className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    >
                      {showPass ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Error */}
                {loginErr && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                  >
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />

                    <span>{loginErr}</span>
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-95 focus:outline-none focus:ring-4 focus:ring-primary/20 active:scale-[0.99]"
                >
                  <LogIn className="size-4" />
                  Sign in
                </button>

                {/* Dev fallback */}
                {import.meta.env.DEV && (
                  <div className="rounded-xl bg-muted/60 px-3 py-2.5 text-center text-xs text-muted-foreground">
                    Development fallback enabled
                    <span className="mx-1.5">·</span>
                    <code className="font-mono">dev / dev</code>
                  </div>
                )}
              </form>

              {/* Backend status */}
              <div className="mt-7 border-t pt-5 dark:border-slate-800">
                {backendUp === null ? (
                  <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <span className="size-2 animate-pulse rounded-full bg-slate-400" />
                    Checking service status…
                  </div>
                ) : backendUp ? (
                  <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="size-3.5 text-emerald-500" />
                    <span>IT Help service is available</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                    <AlertCircle className="size-3.5" />
                    <span>IT Help service is currently unavailable</span>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom legal/status */}
            <div className="mt-5 text-center text-xs text-muted-foreground">
              Authorized corporate users only
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function FeatureCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border bg-white/80 px-3.5 py-3 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/50">
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 shrink-0 rounded-full bg-primary" />
        <span className="text-[12px] font-semibold leading-4">{title}</span>
      </div>

      <p className="mt-1 pl-3 text-[10.5px] leading-4 text-muted-foreground">{description}</p>
    </div>
  );
}
