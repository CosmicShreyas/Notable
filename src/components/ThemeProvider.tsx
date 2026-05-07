import { createContext, useContext, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark";
type ThemePreference = "system" | Theme;
type Ctx = {
  theme: Theme;
  preference: ThemePreference;
  toggle: () => void;
  setTheme: (t: ThemePreference) => void;
};

const ThemeContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "theme-preference";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [systemTheme, setSystemTheme] = useState<Theme>("light");

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const stored = localStorage.getItem(STORAGE_KEY) as ThemePreference | null;

    setPreference(stored === "light" || stored === "dark" || stored === "system" ? stored : "system");
    setSystemTheme(mediaQuery.matches ? "dark" : "light");

    const handleChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const theme = useMemo<Theme>(
    () => (preference === "system" ? systemTheme : preference),
    [preference, systemTheme],
  );

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;

    const favicon = document.querySelector<HTMLLinkElement>('link[data-notable-favicon="primary"]');
    const appleTouchIcon = document.querySelector<HTMLLinkElement>('link[data-notable-apple-icon="true"]');
    const faviconHref = theme === "dark" ? "/notable-logo.png" : "/notable-logo-light.png";

    if (favicon) {
      favicon.href = faviconHref;
    }

    if (appleTouchIcon) {
      appleTouchIcon.href = faviconHref;
    }
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, preference);
  }, [preference]);

  const toggle = () => {
    setPreference((current) => {
      const resolved = current === "system" ? systemTheme : current;
      return resolved === "dark" ? "light" : "dark";
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, preference, setTheme: setPreference, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be inside ThemeProvider");
  return ctx;
}
