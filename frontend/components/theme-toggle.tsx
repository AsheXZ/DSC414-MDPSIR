"use client";

import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as ThemeMode | null;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolvedTheme: ThemeMode = savedTheme ?? (prefersDark ? "dark" : "light");

    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    setTheme(resolvedTheme);
    setMounted(true);
  }, []);

  const toggleTheme = () => {
    const nextTheme: ThemeMode = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    localStorage.setItem("theme", nextTheme);
    setTheme(nextTheme);
  };

  return (
    <button
      type="button"
      aria-label="Toggle dark mode"
      onClick={toggleTheme}
      className="inline-flex items-center gap-2 rounded-full border border-app-panel-border bg-app-panel px-4 py-2 text-xs font-semibold tracking-[0.14em] uppercase text-app-fg transition hover:scale-[1.02]"
    >
      <span
        className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-600 transition dark:bg-cyan-300"
        aria-hidden="true"
      />
      {mounted ? (theme === "dark" ? "Dark" : "Light") : "Theme"}
    </button>
  );
}
