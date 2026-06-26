import type { Language } from "./dictionaries";

// ---------------------------------------------------------------------------
// Plan content translation
//
// Plan descriptions and feature lists are seeded in the database in English
// (see src/lib/db.server.ts -> seedPlans). To keep the UI fully localized
// without a DB migration, we translate those English source strings at render
// time using the maps below. Any string not present in a map falls back to the
// original English text, so future DB changes degrade gracefully.
// ---------------------------------------------------------------------------

type Translations = Record<string, { it: string; ru: string }>;

const DESCRIPTIONS: Translations = {
  "Try rexware for 12 hours. One-time per account and IP.": {
    it: "Prova rexware per 12 ore. Una sola volta per account e IP.",
    ru: "Попробуйте rexware 12 часов. Один раз на аккаунт и IP.",
  },
  "Ideal for small-scale operations and getting started.": {
    it: "Ideale per operazioni su piccola scala e per iniziare.",
    ru: "Идеально для небольших задач и для начала работы.",
  },
  "For power users running multiple bots simultaneously.": {
    it: "Per utenti avanzati che eseguono più bot contemporaneamente.",
    ru: "Для опытных пользователей, запускающих несколько ботов одновременно.",
  },
  "Maximum throughput, dedicated resources and custom setups.": {
    it: "Massima resa, risorse dedicate e configurazioni personalizzate.",
    ru: "Максимальная производительность, выделенные ресурсы и индивидуальные настройки.",
  },
  "Full unrestricted access. Automatically assigned to admins.": {
    it: "Accesso completo e senza restrizioni. Assegnato automaticamente agli admin.",
    ru: "Полный неограниченный доступ. Назначается администраторам автоматически.",
  },
};

const FEATURES: Translations = {
  "1 concurrent bot": {
    it: "1 bot in contemporanea",
    ru: "1 одновременный бот",
  },
  "5 concurrent bots": {
    it: "5 bot in contemporanea",
    ru: "5 одновременных ботов",
  },
  "25 concurrent bots": {
    it: "25 bot in contemporanea",
    ru: "25 одновременных ботов",
  },
  "Unlimited bots": {
    it: "Bot illimitati",
    ru: "Безлимитные боты",
  },
  "5 bot-hours total": {
    it: "5 ore-bot totali",
    ru: "5 бот-часов всего",
  },
  "5 bot-hours / day": {
    it: "5 ore-bot / giorno",
    ru: "5 бот-часов / день",
  },
  "12 bot-hours / day": {
    it: "12 ore-bot / giorno",
    ru: "12 бот-часов / день",
  },
  "Unlimited bot-hours": {
    it: "Ore-bot illimitate",
    ru: "Безлимитные бот-часы",
  },
  "Shared proxies": {
    it: "Proxy condivisi",
    ru: "Общие прокси",
  },
  "10 shared proxies": {
    it: "10 proxy condivisi",
    ru: "10 общих прокси",
  },
  "50 dedicated proxies": {
    it: "50 proxy dedicati",
    ru: "50 выделенных прокси",
  },
  "Unlimited premium proxies": {
    it: "Proxy premium illimitati",
    ru: "Безлимитные премиум-прокси",
  },
  "Unlimited proxies": {
    it: "Proxy illimitati",
    ru: "Безлимитные прокси",
  },
  "Basic telemetry": {
    it: "Telemetria di base",
    ru: "Базовая телеметрия",
  },
  "Basic telemetry & logs": {
    it: "Telemetria e log di base",
    ru: "Базовая телеметрия и логи",
  },
  "Full analytics & live console": {
    it: "Analisi complete e console live",
    ru: "Полная аналитика и живая консоль",
  },
  "Advanced scanner & priority queue": {
    it: "Scanner avanzato e coda prioritaria",
    ru: "Продвинутый сканер и приоритетная очередь",
  },
  "Custom behaviors & API access": {
    it: "Comportamenti personalizzati e accesso API",
    ru: "Пользовательские сценарии и доступ к API",
  },
  "All plugins included": {
    it: "Tutti i plugin inclusi",
    ru: "Все плагины включены",
  },
  "All features unlocked": {
    it: "Tutte le funzioni sbloccate",
    ru: "Все функции разблокированы",
  },
  "Standard beaming speed": {
    it: "Velocità di beaming standard",
    ru: "Стандартная скорость бимминга",
  },
  "Fast beaming speed": {
    it: "Velocità di beaming veloce",
    ru: "Высокая скорость бимминга",
  },
  "Maximum beaming speed": {
    it: "Velocità di beaming massima",
    ru: "Максимальная скорость бимминга",
  },
  "Community support": {
    it: "Supporto della community",
    ru: "Поддержка сообщества",
  },
  "Community Discord support": {
    it: "Supporto Discord della community",
    ru: "Поддержка сообщества в Discord",
  },
  "Priority Discord support": {
    it: "Supporto Discord prioritario",
    ru: "Приоритетная поддержка в Discord",
  },
  "12-hour access": {
    it: "Accesso per 12 ore",
    ru: "Доступ на 12 часов",
  },
  "1 redemption per account & IP": {
    it: "1 riscatto per account e IP",
    ru: "1 активация на аккаунт и IP",
  },
  "Monthly billing": {
    it: "Fatturazione mensile",
    ru: "Ежемесячная оплата",
  },
  "Early access to new features": {
    it: "Accesso anticipato alle nuove funzioni",
    ru: "Ранний доступ к новым функциям",
  },
  "Dedicated 1:1 onboarding": {
    it: "Onboarding dedicato 1:1",
    ru: "Персональный онбординг 1:1",
  },
  "Admin-only access": {
    it: "Accesso riservato agli admin",
    ru: "Доступ только для администраторов",
  },
};

function translate(map: Translations, text: string, lang: Language): string {
  if (lang === "en") return text;
  const entry = map[text];
  if (!entry) return text;
  return entry[lang] ?? text;
}

/** Translate a plan description (English source string) into the active language. */
export function translatePlanDescription(text: string, lang: Language): string {
  return translate(DESCRIPTIONS, text, lang);
}

/** Translate a single plan feature (English source string) into the active language. */
export function translatePlanFeature(text: string, lang: Language): string {
  return translate(FEATURES, text, lang);
}
