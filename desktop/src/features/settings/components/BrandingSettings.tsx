import { useState, useRef } from "react";
import { Upload, Trash2, Image as ImageIcon, Check, AlertCircle } from "lucide-react";
import { apiFetch, authHeaders, BASE } from "@/shared/api/client";

type Branding = { logo: string | null; appName: string | null };

async function fetchBranding(): Promise<Branding> {
  const r = await fetch(`${BASE}/api/branding`);
  if (!r.ok) return { logo: null, appName: null };
  return r.json();
}

/** Settings → Branding: admin-customizable logo (login page + sidebar). */
export function BrandingSettings({ onChanged }: { onChanged?: (b: Branding) => void }) {
  const [branding, setBranding] = useState<Branding>({ logo: null, appName: null });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [appName, setAppName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!loaded) {
    setLoaded(true);
    fetchBranding().then((b) => { setBranding(b); setAppName(b.appName); }).catch(() => {});
  }

  async function upload(file: File) {
    setBusy(true); setErr(null); setSaved(false);
    try {
      if (!["image/png", "image/jpeg"].includes(file.type)) {
        throw new Error("Only PNG or JPG images are allowed");
      }
      if (file.size > 2 * 1024 * 1024) throw new Error("Image exceeds the 2 MB limit");
      const fd = new FormData();
      fd.append("file", file);
      if (appName) fd.append("appName", appName);
      const r = await apiFetch(`${BASE}/api/admin/branding/logo`, {
        method: "PUT", headers: { ...authHeaders() }, body: fd,
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.detail || `Upload failed (HTTP ${r.status})`);
      }
      const b = await fetchBranding();
      setBranding(b);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
      onChanged?.(b);
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function reset() {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`${BASE}/api/admin/branding/logo`, { method: "DELETE", headers: { ...authHeaders() } });
      if (!r.ok) throw new Error(`Reset failed (HTTP ${r.status})`);
      const b = await fetchBranding();
      setBranding(b);
      onChanged?.(b);
    } catch (e: any) {
      setErr(e?.message || "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Preview + upload zone */}
      <div className="flex items-center gap-5 rounded-xl border bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950">
          {branding.logo ? (
            <img src={branding.logo} alt="Current logo" className="size-full object-contain" />
          ) : (
            <span className="text-[11px] font-extrabold tracking-tight text-blue-700">iTH</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">
            {branding.logo ? "Custom logo active" : "Default iTH mark in use"}
          </p>
          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
            PNG or JPG, square recommended, up to 2 MB. Shown on the login page and the sidebar.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-1.5 text-[10px] font-semibold text-white transition hover:bg-sky-600 disabled:opacity-50">
              {busy ? <ImageIcon className="size-3.5 animate-pulse" /> : <Upload className="size-3.5" />}
              {branding.logo ? "Replace logo" : "Upload logo"}
            </button>
            {branding.logo && (
              <button type="button" disabled={busy} onClick={reset}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                <Trash2 className="size-3.5" /> Reset to default
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
        </div>
      </div>

      {/* Optional app-name override for the brand row */}
      <div>
        <label className="mb-1.5 block text-[10px] font-medium text-muted-foreground">
          Brand name (next to the logo) — optional
        </label>
        <input
          value={appName ?? ""}
          onChange={(e) => setAppName(e.target.value)}
          placeholder="IT Help Chatbot"
          className="h-9 w-full max-w-xs rounded-lg border bg-white px-3 text-xs outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900"
        />
      </div>

      {err && (
        <p className="flex items-center gap-1.5 text-[10px] text-rose-600">
          <AlertCircle className="size-3.5" /> {err}
        </p>
      )}
      {saved && (
        <p className="flex items-center gap-1.5 text-[10px] text-emerald-600">
          <Check className="size-3.5" /> Logo updated — visible on the login page immediately
        </p>
      )}
    </div>
  );
}
