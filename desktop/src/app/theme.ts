/** Theme engine — the single owner of [data-theme] + local pref mirrors.
 *
 * v0.21.44: persisted theme must apply on EVERY page load (not only Settings),
 * and applyUserPrefs must never write "undefined" into data-theme (v0.21.44 bug).
 * Keys: ith.dark / ith.compact / ith.animations are mirrored by Settings page.
 */

export function applyStoredTheme(): void {
  const dark = localStorage.getItem("ith.dark") === "1";
  const compact = localStorage.getItem("ith.compact") === "1";
  const animOff = localStorage.getItem("ith.animations") === "0";
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  document.documentElement.dataset.compact = compact ? "1" : "0";
  document.documentElement.classList.toggle("animations-off", animOff);
}

/** Server-prefs -> DOM. Accepts either `theme` ("light"|"dark"|"system") or the
 *  newer boolean `darkMode`; falls back to the local mirror. Never writes "undefined". */
export function applyUserPrefs(s: any): void {
  const root = document.documentElement;
  let theme: string | undefined = s?.theme;
  if (typeof s?.darkMode === "boolean") theme = s.darkMode ? "dark" : "light";
  if (!theme || theme === "undefined") {
    theme = localStorage.getItem("ith.dark") === "1" ? "dark" : "light";
  }
  root.setAttribute("data-theme", theme);
  root.style.setProperty("--chat-font-size", `${s?.chat_font_size || 14}px`);
}
