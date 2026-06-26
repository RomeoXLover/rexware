import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  dictionaries,
  type Language,
} from "./i18n/dictionaries";

// ---------------------------------------------------------------------------
// Client-side preferences: theme (light/dark), language (en/it/ru) and display
// currency (USD/EUR/GBP/INR). Persisted to localStorage so the choice sticks
// across reloads. Default theme is dark, default language English, default
// currency USD.
// ---------------------------------------------------------------------------

export type Theme = "dark" | "light";
export type Currency = "usd" | "eur" | "gbp" | "inr";

/** Nexora colour themes */
export type NexoraTheme =
  | "nexora"     // default violet
  | "dark"       // neutral slate
  | "neon"       // cyberpunk magenta/cyan
  | "forest"     // deep greens
  | "sunset";    // warm oranges/reds

/** Background effect modes */
export type BgEffect = "mesh" | "stars" | "waves" | "dots" | "minimal";

/** Saturation levels */
export type SaturationLevel = "low" | "mid" | "high" | "max";

export const CURRENCIES: {
  code: Currency;
  label: string;
  symbol: string;
  /** Approximate conversion rate from 1 USD. Display-only. */
  rate: number;
}[] = [
  { code: "usd", label: "US Dollar", symbol: "$", rate: 1 },
  { code: "eur", label: "Euro", symbol: "€", rate: 0.92 },
  { code: "gbp", label: "British Pound", symbol: "£", rate: 0.79 },
  { code: "inr", label: "Indian Rupee", symbol: "₹", rate: 83 },
];

const STORAGE_KEY = "mf_prefs_v1";

interface PrefsState {
  theme: Theme;
  language: Language;
  currency: Currency;
  /** Nexora colour theme (nexora | dark | neon | forest | sunset) */
  nexoraTheme: NexoraTheme;
  /** Background effect (mesh | stars | waves | dots | minimal) */
  bgEffect: BgEffect;
  /** Saturation level (low | mid | high | max) */
  saturation: SaturationLevel;
  /** Whether hover effects are enabled */
  hoverEnabled: boolean;
}

const DEFAULTS: PrefsState = {
  theme: "dark",
  language: "en",
  currency: "usd",
  nexoraTheme: "nexora",
  bgEffect: "mesh",
  saturation: "high",
  hoverEnabled: true,
};

interface PrefsContextValue extends PrefsState {
  setTheme: (t: Theme) => void;
  setLanguage: (l: Language) => void;
  setCurrency: (c: Currency) => void;
  setNexoraTheme: (t: NexoraTheme) => void;
  setBgEffect: (e: BgEffect) => void;
  setSaturation: (s: SaturationLevel) => void;
  setHoverEnabled: (v: boolean) => void;
  /** Translate a dot-namespaced key, with EN fallback then the raw key. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Format a USD amount into the active display currency. */
  formatPrice: (usd: number, opts?: { decimals?: number }) => string;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

function readStored(): PrefsState {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PrefsState>;
    return {
      theme: parsed.theme === "light" ? "light" : "dark",
      language:
        parsed.language === "it" || parsed.language === "ru"
          ? parsed.language
          : "en",
      currency:
        parsed.currency && ["usd", "eur", "gbp", "inr"].includes(parsed.currency)
          ? (parsed.currency as Currency)
          : "usd",
      nexoraTheme:
        ["nexora", "dark", "neon", "forest", "sunset"].includes(
          parsed.nexoraTheme ?? "",
        )
          ? (parsed.nexoraTheme as NexoraTheme)
          : "nexora",
      bgEffect:
        ["mesh", "stars", "waves", "dots", "minimal"].includes(
          parsed.bgEffect ?? "",
        )
          ? (parsed.bgEffect as BgEffect)
          : "mesh",
      saturation:
        ["low", "mid", "high", "max"].includes(parsed.saturation ?? "")
          ? (parsed.saturation as SaturationLevel)
          : "high",
      hoverEnabled: parsed.hoverEnabled !== undefined ? !!parsed.hoverEnabled : true,
    };
  } catch {
    return DEFAULTS;
  }
}

function applyBodyClasses(state: PrefsState) {
  if (typeof document === "undefined") return;
  const body = document.body;

  // Reset all classes first
  body.classList.remove(
    "theme-nexora", "theme-dark", "theme-neon", "theme-forest", "theme-sunset",
    "bg-mesh", "bg-stars", "bg-waves", "bg-dots", "bg-minimal",
    "saturation-low", "saturation-mid", "saturation-high", "saturation-max",
    "hover-on", "hover-off",
  );

  // Apply Nexora colour theme
  body.classList.add(`theme-${state.nexoraTheme}`);

  // Apply bg effect
  body.classList.add(`bg-${state.bgEffect}`);

  // Apply saturation
  body.classList.add(`saturation-${state.saturation}`);

  // Apply hover
  body.classList.add(state.hoverEnabled ? "hover-on" : "hover-off");
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PrefsState>(DEFAULTS);

  // Hydrate from storage on mount (avoids SSR mismatch — server renders dark).
  useEffect(() => {
    const stored = readStored();
    setState(stored);
    applyTheme(stored.theme);
    applyBodyClasses(stored);
    document.documentElement.lang = stored.language;
  }, []);

  const persist = useCallback((next: PrefsState) => {
    setState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, []);

  const setTheme = useCallback(
    (theme: Theme) => {
      applyTheme(theme);
      persist({ ...readStored(), ...state, theme });
    },
    [persist, state],
  );

  const setNexoraTheme = useCallback(
    (nexoraTheme: NexoraTheme) => {
      const next = { ...readStored(), ...state, nexoraTheme };
      setState(next);
      applyBodyClasses(next);
      persist(next);
    },
    [persist, state],
  );

  const setBgEffect = useCallback(
    (bgEffect: BgEffect) => {
      const next = { ...readStored(), ...state, bgEffect };
      setState(next);
      applyBodyClasses(next);
      persist(next);
    },
    [persist, state],
  );

  const setSaturation = useCallback(
    (saturation: SaturationLevel) => {
      const next = { ...readStored(), ...state, saturation };
      setState(next);
      applyBodyClasses(next);
      persist(next);
    },
    [persist, state],
  );

  const setHoverEnabled = useCallback(
    (hoverEnabled: boolean) => {
      const next = { ...readStored(), ...state, hoverEnabled };
      setState(next);
      applyBodyClasses(next);
      persist(next);
    },
    [persist, state],
  );

  const setLanguage = useCallback(
    (language: Language) => {
      if (typeof document !== "undefined") document.documentElement.lang = language;
      persist({ ...state, language });
    },
    [persist, state],
  );

  const setCurrency = useCallback(
    (currency: Currency) => persist({ ...state, currency }),
    [persist, state],
  );

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = dictionaries[state.language] ?? dictionaries.en;
      let str = dict[key] ?? dictionaries.en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return str;
    },
    [state.language],
  );

  const formatPrice = useCallback(
    (usd: number, opts?: { decimals?: number }) => {
      const cur = CURRENCIES.find((c) => c.code === state.currency) ?? CURRENCIES[0];
      const converted = usd * cur.rate;
      const decimals =
        opts?.decimals ?? (cur.code === "inr" ? 0 : 2);
      const formatted = converted.toLocaleString(
        state.language === "it" ? "it-IT" : state.language === "ru" ? "ru-RU" : "en-US",
        { minimumFractionDigits: decimals, maximumFractionDigits: decimals },
      );
      return `${cur.symbol}${formatted}`;
    },
    [state.currency, state.language],
  );

  const value = useMemo<PrefsContextValue>(
    () => ({
      ...state,
      setTheme,
      setLanguage,
      setCurrency,
      setNexoraTheme,
      setBgEffect,
      setSaturation,
      setHoverEnabled,
      t,
      formatPrice,
    }),
    [state, setTheme, setLanguage, setCurrency, setNexoraTheme, setBgEffect, setSaturation, setHoverEnabled, t, formatPrice],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePreferences(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) {
    throw new Error("usePreferences must be used within a PreferencesProvider");
  }
  return ctx;
}

/** Convenience hook: returns just the translate function. */
export function useT() {
  return usePreferences().t;
}
