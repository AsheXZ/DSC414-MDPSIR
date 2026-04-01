"use client";

import { useState } from "react";

type ThemeMode = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof document !== "undefined" && document.documentElement.classList.contains("dark")) {
      return "dark";
    }
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("theme") as ThemeMode | null;
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      return savedTheme ?? (prefersDark ? "dark" : "light");
    }
    return "light";
  });

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
      className="inline-flex items-center gap-2 rounded-full border border-app-panel-border bg-app-panel px-4 py-2 text-xs font-semibold tracking-[0.14em] uppercase text-app-fg transition hover:bg-app"
    >
      <span
        className="inline-block h-2.5 w-2.5 rounded-full bg-[#3e8dcf] transition dark:bg-[#77bdf4]"
        aria-hidden="true"
      />
      {theme === "dark" ? "Dark" : "Light"}
    </button>
  );
}
