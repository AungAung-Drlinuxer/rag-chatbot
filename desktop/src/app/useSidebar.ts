/** B-3 — collapsible sidebar state, shared by every shell (persisted ith.sidebar). */
import { useEffect, useState } from "react";

const KEY = "ith.sidebar"; // "expanded" (default) | "collapsed"

export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(KEY) === "collapsed");

  useEffect(() => {
    localStorage.setItem(KEY, collapsed ? "collapsed" : "expanded");
  }, [collapsed]);

  // Cmd/Ctrl+B toggles globally (Linear/Notion convention)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsed((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = () => setCollapsed((v) => !v);
  return [collapsed, toggle];
}
