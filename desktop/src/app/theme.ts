/** Theme engine — the single owner of [data-theme].
 * Theme and UI preferences are fetched from the server DB on user login / session restore.
 * No preferences are stored in local files / localStorage.
 */

export function applyStoredTheme(): void {
  // Initial default before server preferences load
  const current = document.documentElement.getAttribute("data-theme");
  if (!current) {
    document.documentElement.setAttribute("data-theme", "light");
  }
}

/** Server-prefs -> DOM. Accepts either `theme` ("light"|"dark"|"system") or `darkMode`.
 *  Applies directly to DOM. Never writes to localStorage.
 */
export function applyUserPrefs(s: any): void {
  const root = document.documentElement;
  let theme: string | undefined = s?.theme;
  // If theme is explicit ("dark" | "light"), trust theme over legacy darkMode
  if (s?.theme === "dark" || s?.theme === "light") {
    theme = s.theme;
  } else if (typeof s?.darkMode === "boolean") {
    theme = s.darkMode ? "dark" : "light";
  }

  if (!theme || theme === "undefined" || theme === "system") {
    // Check system preference if system or undefined
    const prefersDark = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    theme = prefersDark ? "dark" : "light";
  }
  root.setAttribute("data-theme", theme);
  if (typeof s?.compact === "boolean") {
    root.dataset.compact = s.compact ? "1" : "0";
  }
  if (typeof s?.animations === "boolean") {
    root.classList.toggle("animations-off", !s.animations);
  }
  root.style.setProperty("--chat-font-size", `${s?.chat_font_size || 14}px`);
}
