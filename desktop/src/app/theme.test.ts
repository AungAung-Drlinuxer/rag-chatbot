/** Unit tests for the theme engine (app/theme.ts) — guards the v0.21.44 bug
 *  class: data-theme must never receive "undefined", server/local key mirrors. */
import { describe, it, expect, beforeEach } from "vitest";
import { applyStoredTheme, applyUserPrefs } from "@/app/theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-compact");
  document.documentElement.classList.remove("animations-off");
});

describe("applyStoredTheme", () => {
  it("defaults to light when nothing stored", () => {
    applyStoredTheme();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
  it("restores dark + compact + animations-off from the ith.* mirrors", () => {
    localStorage.setItem("ith.dark", "1");
    localStorage.setItem("ith.compact", "1");
    localStorage.setItem("ith.animations", "0");
    applyStoredTheme();
    const root = document.documentElement;
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.dataset.compact).toBe("1");
    expect(root.classList.contains("animations-off")).toBe(true);
  });
});

describe("applyUserPrefs", () => {
  it("theme string wins", () => {
    applyUserPrefs({ theme: "dark" });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
  it("darkMode boolean overrides stale theme field", () => {
    applyUserPrefs({ theme: "light", darkMode: true });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
  it("NEVER writes the literal string undefined (v0.21.44 regression guard)", () => {
    applyUserPrefs({ theme: "undefined" });
    expect(document.documentElement.getAttribute("data-theme")).not.toBe("undefined");
    applyUserPrefs({});
    expect(document.documentElement.getAttribute("data-theme")).not.toBe("undefined");
    applyUserPrefs(undefined);
    expect(document.documentElement.getAttribute("data-theme")).not.toBe("undefined");
  });
  it("falls back to the ith.dark mirror, then default font size", () => {
    localStorage.setItem("ith.dark", "1");
    applyUserPrefs({});
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--chat-font-size")).toBe("14px");
    applyUserPrefs({ chat_font_size: 16 });
    expect(document.documentElement.style.getPropertyValue("--chat-font-size")).toBe("16px");
  });
});
