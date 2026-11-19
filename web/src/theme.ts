import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";
const KEY = "zfstack.theme";

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const t = theme === "system" ? (mq.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = t;
    };
    apply();
    mq.addEventListener("change", apply);
    try {
      if (theme === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      /* storage blocked: theme still applies for this session */
    }
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  return [theme, setTheme];
}
