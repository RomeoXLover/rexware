import { useCallback, useMemo, useRef, useState } from "react";
import { Bot, Languages, X, MessageCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePreferences } from "@/lib/preferences";
import { LANGUAGES, type Language } from "@/lib/i18n/dictionaries";
import { DOCS_DISCORD_URL, type DocsSection } from "@/lib/i18n/docs-content";
import { ICONS, SectionView } from "@/components/docs-renderer";

// ---------------------------------------------------------------------------
// Bot Guide — a focused, multilingual popup that walks users through deploying
// and running bots. It reuses the exact same docs renderer (SectionView) so it
// looks identical to /docs, but only contains bot-specific topics.
// ---------------------------------------------------------------------------

type GuideChrome = {
  title: string;
  subtitle: string;
  ctaTitle: string;
  ctaText: string;
  ctaButton: string;
  langLabel: string;
  close: string;
};

type GuideContent = { chrome: GuideChrome; sections: DocsSection[] };

const CONTENT: Record<Language, GuideContent> = {
  en: {
    chrome: {
      title: "Bot Guide",
      subtitle: "Deploy, authenticate and run your beam bots in minutes.",
      ctaTitle: "Still stuck?",
      ctaText:
        "Our team lives in Discord and replies fast. Reach us directly any time.",
      ctaButton: "Join our Discord",
      langLabel: "Language",
      close: "Close",
    },
    sections: [
      {
        id: "deploying-bots",
        icon: "rocket",
        title: "Deploy a bot",
        lead: "Go from credentials to a live, connected bot in under a minute.",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Click “Deploy Bot”",
                text: "Open the deploy dialog from the bots panel. Each plan has a limit shown next to the button.",
              },
              {
                title: "Name your bot & pick a version",
                text: "Give it a recognizable name and select the Minecraft version that matches your target server.",
              },
              {
                title: "Choose an auth mode",
                text: "Pick how the bot signs in — Microsoft, Offline or SSID. See the next section for details.",
              },
              {
                title: "Enter the server address",
                text: "Set the host (and port if non-default). The bot will connect here when started.",
              },
              {
                title: "Deploy & start",
                text: "Save the bot, then hit Start. Watch it connect live in the console.",
              },
            ],
          },
          {
            kind: "callout",
            tone: "tip",
            title: "Tip",
            text: "You can edit every setting later from the bot's detail page — nothing is permanent.",
          },
        ],
      },
      {
        id: "auth-modes",
        icon: "shield",
        title: "Authentication modes",
        lead: "Choose how each bot authenticates with Minecraft.",
        blocks: [
          {
            kind: "fields",
            rows: [
              {
                name: "Microsoft",
                desc: "Sign in once via microsoft.com/link. Best for premium servers that require a real account.",
              },
              {
                name: "Offline",
                type: "cracked",
                desc: "No account needed. Use for cracked / offline-mode servers only.",
              },
              {
                name: "SSID",
                type: "token",
                desc: "Paste an existing session token to authenticate instantly without the link flow.",
              },
            ],
          },
          {
            kind: "callout",
            tone: "warn",
            title: "Premium servers",
            text: "Offline mode will be rejected by servers running in online mode. Use Microsoft or SSID there.",
          },
        ],
      },
      {
        id: "running-bots",
        icon: "terminal",
        title: "Run & monitor",
        lead: "Start, stop and watch your bots in real time.",
        blocks: [
          {
            kind: "cards",
            items: [
              {
                title: "Start / Stop",
                desc: "Toggle a bot on or off any time. Status updates instantly in the list.",
              },
              {
                title: "Live console",
                desc: "Stream each bot's output as it connects, chats and runs commands.",
              },
              {
                title: "Auto-replies",
                desc: "Configure triggers so the bot responds to in-game messages on its own.",
              },
              {
                title: "Webhooks",
                desc: "Forward events to Discord or your own endpoint to stay notified.",
              },
            ],
          },
          {
            kind: "callout",
            tone: "info",
            title: "Uptime",
            text: "Bots run in isolated containers. Your available hours depend on your plan.",
          },
        ],
      },
    ],
  },
  it: {
    chrome: {
      title: "Guida ai bot",
      subtitle: "Distribuisci, autentica e avvia i tuoi bot in pochi minuti.",
      ctaTitle: "Ancora bloccato?",
      ctaText:
        "Il nostro team è su Discord e risponde in fretta. Contattaci quando vuoi.",
      ctaButton: "Entra nel Discord",
      langLabel: "Lingua",
      close: "Chiudi",
    },
    sections: [
      {
        id: "deploying-bots",
        icon: "rocket",
        title: "Distribuisci un bot",
        lead: "Dalle credenziali a un bot connesso in meno di un minuto.",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Clicca “Distribuisci bot”",
                text: "Apri la finestra di deploy dal pannello bot. Ogni piano ha un limite indicato vicino al pulsante.",
              },
              {
                title: "Dai un nome e scegli la versione",
                text: "Assegna un nome riconoscibile e seleziona la versione di Minecraft del server di destinazione.",
              },
              {
                title: "Scegli la modalità di auth",
                text: "Decidi come accede il bot — Microsoft, Offline o SSID. Dettagli nella sezione successiva.",
              },
              {
                title: "Inserisci l'indirizzo del server",
                text: "Imposta l'host (e la porta se non standard). Il bot si connetterà qui all'avvio.",
              },
              {
                title: "Distribuisci e avvia",
                text: "Salva il bot, poi premi Avvia. Guardalo connettersi in tempo reale nella console.",
              },
            ],
          },
          {
            kind: "callout",
            tone: "tip",
            title: "Suggerimento",
            text: "Puoi modificare ogni impostazione in seguito dalla pagina del bot — niente è definitivo.",
          },
        ],
      },
      {
        id: "auth-modes",
        icon: "shield",
        title: "Modalità di autenticazione",
        lead: "Scegli come ogni bot si autentica con Minecraft.",
        blocks: [
          {
            kind: "fields",
            rows: [
              {
                name: "Microsoft",
                desc: "Accedi una volta via microsoft.com/link. Ideale per server premium che richiedono un account reale.",
              },
              {
                name: "Offline",
                type: "cracked",
                desc: "Nessun account necessario. Solo per server cracked / in modalità offline.",
              },
              {
                name: "SSID",
                type: "token",
                desc: "Incolla un token di sessione esistente per autenticarti subito senza il flusso link.",
              },
            ],
          },
          {
            kind: "callout",
            tone: "warn",
            title: "Server premium",
            text: "La modalità Offline viene rifiutata dai server in modalità online. Lì usa Microsoft o SSID.",
          },
        ],
      },
      {
        id: "running-bots",
        icon: "terminal",
        title: "Avvio e monitoraggio",
        lead: "Avvia, ferma e osserva i tuoi bot in tempo reale.",
        blocks: [
          {
            kind: "cards",
            items: [
              {
                title: "Avvia / Ferma",
                desc: "Accendi o spegni un bot quando vuoi. Lo stato si aggiorna subito nella lista.",
              },
              {
                title: "Console live",
                desc: "Segui l'output di ogni bot mentre si connette, chatta ed esegue comandi.",
              },
              {
                title: "Risposte automatiche",
                desc: "Configura trigger così il bot risponde da solo ai messaggi in gioco.",
              },
              {
                title: "Webhook",
                desc: "Inoltra gli eventi a Discord o a un tuo endpoint per restare aggiornato.",
              },
            ],
          },
          {
            kind: "callout",
            tone: "info",
            title: "Uptime",
            text: "I bot girano in container isolati. Le ore disponibili dipendono dal tuo piano.",
          },
        ],
      },
    ],
  },
  ru: {
    chrome: {
      title: "Руководство по ботам",
      subtitle: "Запустите, авторизуйте и управляйте ботами за минуты.",
      ctaTitle: "Всё ещё не получается?",
      ctaText:
        "Наша команда в Discord и быстро отвечает. Пишите нам в любое время.",
      ctaButton: "Зайти в Discord",
      langLabel: "Язык",
      close: "Закрыть",
    },
    sections: [
      {
        id: "deploying-bots",
        icon: "rocket",
        title: "Запуск бота",
        lead: "От учётных данных до подключённого бота меньше чем за минуту.",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Нажмите «Запустить бота»",
                text: "Откройте окно запуска в панели ботов. У каждого плана есть лимит рядом с кнопкой.",
              },
              {
                title: "Назовите бота и выберите версию",
                text: "Дайте понятное имя и выберите версию Minecraft нужного сервера.",
              },
              {
                title: "Выберите режим авторизации",
                text: "Решите, как бот входит — Microsoft, Offline или SSID. Подробности в следующем разделе.",
              },
              {
                title: "Укажите адрес сервера",
                text: "Задайте хост (и порт, если нестандартный). Бот подключится сюда при старте.",
              },
              {
                title: "Запустите бота",
                text: "Сохраните бота, затем нажмите Старт. Следите за подключением в консоли.",
              },
            ],
          },
          {
            kind: "callout",
            tone: "tip",
            title: "Совет",
            text: "Любую настройку можно изменить позже на странице бота — ничего не фиксируется навсегда.",
          },
        ],
      },
      {
        id: "auth-modes",
        icon: "shield",
        title: "Режимы авторизации",
        lead: "Выберите, как каждый бот авторизуется в Minecraft.",
        blocks: [
          {
            kind: "fields",
            rows: [
              {
                name: "Microsoft",
                desc: "Войдите один раз через microsoft.com/link. Лучше для premium-серверов с реальным аккаунтом.",
              },
              {
                name: "Offline",
                type: "cracked",
                desc: "Аккаунт не нужен. Только для cracked / offline-серверов.",
              },
              {
                name: "SSID",
                type: "token",
                desc: "Вставьте существующий токен сессии для мгновенной авторизации без link-входа.",
              },
            ],
          },
          {
            kind: "callout",
            tone: "warn",
            title: "Premium-серверы",
            text: "Offline-режим отклоняется серверами в online-режиме. Там используйте Microsoft или SSID.",
          },
        ],
      },
      {
        id: "running-bots",
        icon: "terminal",
        title: "Запуск и мониторинг",
        lead: "Запускайте, останавливайте и наблюдайте за ботами в реальном времени.",
        blocks: [
          {
            kind: "cards",
            items: [
              {
                title: "Старт / Стоп",
                desc: "Включайте и выключайте бота в любой момент. Статус обновляется мгновенно.",
              },
              {
                title: "Живая консоль",
                desc: "Смотрите вывод каждого бота при подключении, чате и выполнении команд.",
              },
              {
                title: "Автоответы",
                desc: "Настройте триггеры, чтобы бот сам отвечал на сообщения в игре.",
              },
              {
                title: "Вебхуки",
                desc: "Пересылайте события в Discord или на свой эндпоинт, чтобы быть в курсе.",
              },
            ],
          },
          {
            kind: "callout",
            tone: "info",
            title: "Аптайм",
            text: "Боты работают в изолированных контейнерах. Доступные часы зависят от вашего плана.",
          },
        ],
      },
    ],
  },
};

export function BotGuideDialog({
  open,
  onOpenChange,
  initialSection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: string;
}) {
  const { language, setLanguage } = usePreferences();
  const { chrome, sections } = useMemo(
    () => CONTENT[language] ?? CONTENT.en,
    [language],
  );

  const [activeId, setActiveId] = useState(initialSection ?? sections[0]?.id);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sectionEls = useRef<Map<string, HTMLElement>>(new Map());

  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) sectionEls.current.set(id, el);
    else sectionEls.current.delete(id);
  }, []);

  const scrollTo = useCallback((id: string) => {
    setActiveId(id);
    const el = sectionEls.current.get(id);
    const container = scrollRef.current;
    if (el && container) {
      container.scrollTo({ top: el.offsetTop - 16, behavior: "smooth" });
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[88vh] max-h-[760px] w-[96vw] max-w-3xl flex-col gap-0 overflow-hidden rounded-3xl border-border/70 bg-background/95 p-0 backdrop-blur-2xl sm:w-[90vw]"
      >
        {/* Header */}
        <div className="relative shrink-0 border-b border-border/50 bg-card/40 px-5 py-4 sm:px-6">
          <div
            className="pointer-events-none absolute inset-0 -z-10 opacity-60"
            style={{ background: "var(--gradient-hero)" }}
            aria-hidden="true"
          />
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-card/70 text-foreground">
              <Bot className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-lg font-semibold tracking-tight">
                {chrome.title}
              </DialogTitle>
              <DialogDescription className="truncate text-xs text-muted-foreground">
                {chrome.subtitle}
              </DialogDescription>
            </div>

            {/* Language switcher */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-full border-border/60 bg-card/60"
                  aria-label={chrome.langLabel}
                >
                  <Languages className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {LANGUAGES.map((l) => (
                  <DropdownMenuItem
                    key={l.code}
                    onClick={() => setLanguage(l.code as Language)}
                    className={language === l.code ? "bg-accent" : ""}
                  >
                    <span className="mr-2">{l.flag}</span>
                    {l.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full"
              onClick={() => onOpenChange(false)}
              aria-label={chrome.close}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Quick nav pills */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {sections.map((s) => {
              const Icon = ICONS[s.icon] ?? Bot;
              const active = activeId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => scrollTo(s.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                    active
                      ? "border-foreground/20 bg-foreground/10 text-foreground"
                      : "border-border/60 bg-card/40 text-muted-foreground hover:border-border hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {s.title}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
          <div className="flex flex-col gap-12">
            {sections.map((s) => (
              <SectionView key={s.id} section={s} register={register} />
            ))}

            {/* CTA */}
            <div className="ac-spotlight relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 p-6 text-center">
              <div
                className="pointer-events-none absolute inset-0 -z-10 opacity-50"
                style={{ background: "var(--gradient-hero)" }}
                aria-hidden="true"
              />
              <h3 className="text-lg font-semibold tracking-tight">
                {chrome.ctaTitle}
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                {chrome.ctaText}
              </p>
              <Button asChild className="mt-5 rounded-full">
                <a
                  href={DOCS_DISCORD_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <MessageCircle className="mr-2 h-4 w-4" />
                  {chrome.ctaButton}
                </a>
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
