// ---------------------------------------------------------------------------
// skyutils documentation content — fully trilingual (EN / IT / RU).
//
// The *structure* (section ids, icons, block kinds, terminal demos) is shared
// via a single builder so every language stays perfectly in sync. Only the
// human copy differs per language, held in the flat STRINGS maps below.
//
// Console/terminal demos are intentionally language-neutral (commands and log
// lines are universal), so they live in the shared builder and are not
// translated — exactly how a real terminal would look.
// ---------------------------------------------------------------------------

import type { Language } from "./dictionaries";

/* ─── Block + section types ─── */

export type TermLineType =
  | "cmd" // a command the user typed ($ or >)
  | "out" // neutral program output
  | "ok" // success line
  | "warn" // warning line
  | "err" // error line
  | "muted" // dim / comment
  | "prompt" // interactive prompt (? field)
  | "chat"; // in-game chat / trigger

export type TermLine = { t: TermLineType; text: string };

export type TerminalTab = {
  label: string; // tab label (translated)
  title: string; // window title bar text
  lines: TermLine[];
};

export type DocsBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "steps"; items: { title: string; text: string }[] }
  | { kind: "fields"; rows: { name: string; type?: string; desc: string }[] }
  | { kind: "table"; headers: string[]; rows: string[][]; highlight?: number }
  | {
      kind: "callout";
      tone: "info" | "tip" | "warn";
      title: string;
      text: string;
    }
  | { kind: "terminal"; tabs: TerminalTab[] }
  | { kind: "cards"; items: { title: string; desc: string }[] };

export type DocsSection = {
  id: string;
  icon: string; // mapped to a lucide icon in docs.tsx
  title: string;
  lead?: string;
  blocks: DocsBlock[];
};

export type DocsChrome = {
  badge: string;
  title: string;
  subtitle: string;
  searchPlaceholder: string;
  searchEmpty: string;
  searchEmptyHint: string;
  onThisPage: string;
  navHeading: string;
  copy: string;
  copied: string;
  backHome: string;
  signIn: string;
  openDashboard: string;
  ctaTitle: string;
  ctaText: string;
  ctaButton: string;
  langLabel: string;
  themeLabel: string;
  updated: string;
};

export type DocsContent = {
  chrome: DocsChrome;
  sections: DocsSection[];
};

/* ─── Flat per-language string maps ─── */

type S = Record<string, string>;

/* ============================ ENGLISH ============================ */
const en: S = {
  "chrome.badge": "Docs",
  "chrome.title": "skyutils Documentation",
  "chrome.subtitle":
    "Everything you need to deploy, run and master your beam bots — from your first sign-in to advanced presets and plugins.",
  "chrome.search": "Search the docs…",
  "chrome.searchEmpty": "No matches found",
  "chrome.searchEmptyHint": "Try a different keyword or browse the sections.",
  "chrome.onThisPage": "On this page",
  "chrome.nav": "Documentation",
  "chrome.copy": "Copy",
  "chrome.copied": "Copied",
  "chrome.backHome": "Back to home",
  "chrome.signIn": "Sign in",
  "chrome.openDashboard": "Open dashboard",
  "chrome.ctaTitle": "Still stuck?",
  "chrome.ctaText":
    "Our team lives in Discord and replies fast. Open a support ticket from your dashboard or reach us directly.",
  "chrome.ctaButton": "Join our Discord",
  "chrome.langLabel": "Language",
  "chrome.themeLabel": "Toggle theme",
  "chrome.updated": "Last updated",

  // Introduction
  "intro.title": "Introduction",
  "intro.lead":
    "skyutils is a premium platform to autobeam Minecraft accounts. Deploy multiple undetected bots and run everything from one clean dashboard.",
  "intro.p1":
    "A “beam bot” is a Minecraft client that logs into a server on your behalf and stays online — moving naturally, replying to messages and running your commands around the clock. skyutils runs each bot in its own isolated container so accounts never share state.",
  "intro.cards.multi.t": "Multi-bot management",
  "intro.cards.multi.d":
    "Spin up multiple bots and manage their config, proxies and logs from a single place.",
  "intro.cards.undetected.t": "Built to stay hidden",
  "intro.cards.undetected.d":
    "Rotating proxies, humanlike movement and a unique fingerprint per account.",
  "intro.cards.console.t": "Live console",
  "intro.cards.console.d":
    "Watch each bot’s output in real time as it connects, broadcasts and auto-replies.",
  "intro.cards.deploy.t": "Instant deploy",
  "intro.cards.deploy.d":
    "Go from credentials to a live, connected bot in under a minute.",

  // Quick start
  "qs.title": "Quick start",
  "qs.lead": "Four steps from zero to a live bot.",
  "qs.s1.t": "Sign in with Discord",
  "qs.s1.d":
    "Click Sign in and authorize with Discord. There are no passwords or email lists — your Discord account is your identity.",
  "qs.s2.t": "Activate a plan",
  "qs.s2.d":
    "Open the Purchase section and pick a plan. New here? Redeem the free 12-hour trial to try everything first.",
  "qs.s3.t": "Deploy your first bot",
  "qs.s3.d":
    "Go to Bots → Deploy, fill in the account and server details, and save.",
  "qs.s4.t": "Press Start & watch the console",
  "qs.s4.d":
    "Hit Start and open the live console to confirm your bot connects and stays online.",
  "qs.callout.t": "Try before you buy",
  "qs.callout.d":
    "Every new account can redeem one free 12-hour trial — no crypto required to start.",

  // Sign in
  "signin.title": "Signing in",
  "signin.lead": "Access is handled exclusively through Discord OAuth.",
  "signin.p1":
    "skyutils never stores passwords. When you click Sign in you’re redirected to Discord to authorize the app, then returned to your dashboard. This keeps your account secure and onboarding instant.",
  "signin.list.1": "No passwords, no email lists, no friction.",
  "signin.list.2":
    "Your subscription, bots and billing history are tied to your Discord identity.",
  "signin.list.3":
    "Sign out anytime from Settings → Account; sessions are per-device.",
  "signin.warn.t": "Don’t confuse the two logins",
  "signin.warn.d":
    "Discord sign-in unlocks the skyutils dashboard. The Minecraft account a bot uses is a separate credential you set when deploying a bot (see Auth modes).",

  // Dashboard
  "dash.title": "The dashboard",
  "dash.lead": "Everything is organized into focused sections in the sidebar.",
  "dash.rows.overview":
    "Your bots at a glance — status, plan and quick actions.",
  "dash.rows.purchase":
    "Browse plans, redeem the trial and check out with crypto.",
  "dash.rows.bots": "Deploy, configure, start/stop and open the live console.",
  "dash.rows.billing": "Payment history and subscription management.",
  "dash.rows.proxies": "Add and rotate proxies to keep every account safe.",
  "dash.rows.plugins":
    "Optional add-ons like Discord Spam and Discord Auto-Reply.",
  "dash.rows.tickets": "Open a support ticket and chat with the team.",

  // Bots
  "bots.title": "Deploying bots",
  "bots.lead":
    "A bot is one Minecraft account connected to one server. Create as many as your plan allows.",
  "bots.p1":
    "Open Bots → Deploy to create a bot. Fields left blank fall back to sensible defaults shown as placeholders. You can edit any field later from the bot’s detail page.",
  "bots.fieldsTitle": "Field reference",
  "bots.f.name": "Friendly label shown across the dashboard.",
  "bots.f.username": "The in-game username the bot connects with.",
  "bots.f.host": "Server address, e.g. play.example.net.",
  "bots.f.port": "Server port. Defaults to 25565.",
  "bots.f.version": "Minecraft version the client should emulate.",
  "bots.f.auth": "How the bot authenticates — see Auth modes below.",
  "bots.authTitle": "Auth modes",
  "bots.auth.offline.t": "Offline (cracked)",
  "bots.auth.offline.d":
    "For servers in offline mode. No Mojang/Microsoft account required — just a username.",
  "bots.auth.ms.t": "Microsoft",
  "bots.auth.ms.d":
    "Logs in with a genuine Microsoft/Minecraft account for premium servers. You can optionally provide an access token.",
  "bots.auth.ssid.t": "SSID token",
  "bots.auth.ssid.d":
    "Authenticate with a session (SSID) token when you already have one — handy for reusing an existing session.",
  "bots.deployTermLabel": "Deploy",
  "bots.tip.t": "Capacity",
  "bots.tip.d":
    "Your plan sets how many bots run at once and how many bot-hours you get per day. Track both from the Bots header.",

  // Console
  "console.title": "The live console",
  "console.lead":
    "Each bot streams its container output to your browser in real time.",
  "console.p1":
    "Open any bot and switch to the console to watch it work as it happens — connecting, authenticating, broadcasting its message and auto-replying to triggers. The console is a live, read-only view of the bot’s output, streamed over a persistent connection, so there’s nothing to refresh.",
  "console.tabLog": "Live log",
  "console.tabReply": "Auto-reply",
  "console.list.1":
    "Connection and authentication events as the bot joins the server.",
  "console.list.2":
    "Every broadcast and auto-reply the bot sends, the moment it happens.",
  "console.list.3":
    "Proxy rotation, anti-AFK and automatic reconnect activity.",
  "console.tip.t": "Read-only by design",
  "console.tip.d":
    "The console mirrors what your bot is doing — it isn’t an input box. To change what the bot says or does, edit its message, trigger keyword and reply actions in the bot’s config.",

  // Reply actions
  "reply.title": "Reply actions",
  "reply.lead": "Tell a bot exactly what to do when it replies to a trigger.",
  "reply.p1":
    "Reply actions are an ordered list of command templates the bot runs automatically when its trigger keyword is detected. Use the {user} placeholder for the sender and {reply} for your configured reply text. Actions run top to bottom.",
  "reply.list.1": "{user} — the username that triggered the reply.",
  "reply.list.2": "{reply} — your configured reply message.",
  "reply.list.3":
    "With no custom actions the bot falls back to /msg {user} {reply}.",
  "reply.termLabel": "Reply action",
  "reply.tip.t": "Order matters",
  "reply.tip.d":
    "Actions execute in sequence, so put teleports or setup commands before the message you want to send.",

  // Presets
  "presets.title": "Presets",
  "presets.lead": "Reusable, ordered sets of reply actions.",
  "presets.p1":
    "Save a set of reply actions as a preset and apply it to any bot in one click. A preset can also carry a server host, port and version so applying it sets the connection too.",
  "presets.cards.global.t": "Global presets",
  "presets.cards.global.d":
    "Curated by admins and visible to everyone — a great starting point.",
  "presets.cards.custom.t": "My presets",
  "presets.cards.custom.d":
    "Your own saved sets, private to your account. Save up to 20 actions per preset.",
  "presets.tip.t": "Save once, reuse everywhere",
  "presets.tip.d":
    "Build your perfect reply flow on one bot, hit Save as preset, then apply it across all your bots.",

  // Proxies
  "proxies.title": "Proxies",
  "proxies.lead": "Add and rotate proxies to keep every account safe.",
  "proxies.p1":
    "Proxies route each bot’s traffic through a different IP so your accounts don’t all originate from one address. skyutils rotates them automatically across your bots.",
  "proxies.list.1": "Add proxies in the Proxies section of the dashboard.",
  "proxies.list.2":
    "Each bot picks up rotation automatically — no per-bot setup.",
  "proxies.list.3":
    "Your plan includes a proxy allowance (10 / 50 / unlimited).",
  "proxies.warn.t": "Use quality proxies",
  "proxies.warn.d":
    "Cheap, shared or flagged IPs increase detection risk. Residential or dedicated proxies perform best.",

  // Plugins
  "plugins.title": "Plugins",
  "plugins.lead": "Optional add-ons that extend your bots beyond beaming.",
  "plugins.p1":
    "Plugins are unlocked separately and appear in the sidebar once owned. Each runs in its own container with proxy support and a live console, just like a bot.",
  "plugins.cards.spam.t": "Discord Spam",
  "plugins.cards.spam.d":
    "Multi-token channel spammer with token rotation, auto-delete and a live console.",
  "plugins.cards.reply.t": "Discord Auto-Reply",
  "plugins.cards.reply.d":
    "Hands-off DM responder with DM and Friend modes and humanized timing.",

  // Plans
  "plans.title": "Plans & pricing",
  "plans.lead":
    "Pick the tier that fits your needs. Upgrade or downgrade anytime.",
  "plans.h.plan": "Plan",
  "plans.h.price": "Price",
  "plans.h.bots": "Bots",
  "plans.h.hours": "Bot-hours",
  "plans.h.proxies": "Proxies",
  "plans.h.speed": "Speed",
  "plans.starter": "Rookie",
  "plans.pro": "Elite",
  "plans.enterprise": "Champion",
  "plans.month": "/mo",
  "plans.unlimited": "Unlimited",
  "plans.speed.standard": "Standard",
  "plans.speed.fast": "Fast",
  "plans.speed.max": "Maximum",
  "plans.tip.t": "Not sure yet?",
  "plans.tip.d":
    "Redeem the free 12-hour trial first — every feature is unlocked so you can test your setup before paying.",

  // Billing
  "billing.title": "Billing & payments",
  "billing.lead": "Simple crypto checkout. No fiat, no stored cards.",
  "billing.p1":
    "Plans and plugins are paid in cryptocurrency. At checkout you pick a coin, send the exact amount shown to the generated address, and your access unlocks automatically once the transaction is seen on-chain.",
  "billing.steps.1.t": "Choose a plan or plugin",
  "billing.steps.1.d": "Open Purchase and select what you want.",
  "billing.steps.2.t": "Pick a coin & pay",
  "billing.steps.2.d":
    "Send the exact amount to the address shown — keep the window open.",
  "billing.steps.3.t": "Auto-unlock",
  "billing.steps.3.d":
    "Once confirmed on-chain, your plan or plugin activates instantly.",
  "billing.list.1":
    "Billing is processed in USD; prices can display in your currency.",
  "billing.list.2": "Plans renew monthly. Cancel anytime from your dashboard.",
  "billing.list.3":
    "You keep access until the end of the current billing period after cancelling.",
  "billing.warn.t": "Send the exact amount",
  "billing.warn.d":
    "Crypto payments are matched by amount. Sending a different value can delay or miss the match — copy the amount and address shown.",

  // Safety
  "safety.title": "Account safety",
  "safety.lead": "How skyutils keeps bots below detection thresholds.",
  "safety.p1":
    "No automation is ever 100% risk-free, but skyutils is engineered to blend in. Combine these practices to minimize risk.",
  "safety.list.1": "Rotating proxies so accounts don’t share an IP.",
  "safety.list.2": "Humanlike movement and anti-AFK patterns.",
  "safety.list.3": "A unique fingerprint per account.",
  "safety.list.4": "Reasonable bot-hours rather than 24/7 on fresh accounts.",
  "safety.tip.t": "Warm up new accounts",
  "safety.tip.d":
    "Start new accounts with shorter sessions and lighter activity, then ramp up gradually.",

  // FAQ
  "faq.title": "FAQ",
  "faq.lead": "Quick answers to common questions.",
  "faq.q1": "What exactly is skyutils?",
  "faq.a1":
    "A platform that runs Minecraft bots designed to passively beam accounts. You manage the entire operation — credentials, proxies, behaviors and logs — from one dashboard.",
  "faq.q2": "Will my accounts get banned?",
  "faq.a2":
    "Every bot uses rotating proxies, humanlike movement and a unique fingerprint. No automation is 100% safe, but skyutils is built to stay below detection thresholds on major servers.",
  "faq.q3": "How do I sign in?",
  "faq.a3": "Exclusively through Discord OAuth — no passwords or email lists.",
  "faq.q4": "Can I cancel my subscription?",
  "faq.a4":
    "Yes. Plans are billed monthly and you can cancel anytime; you keep access until the end of the current period.",
  "faq.q5": "Which payment methods do you accept?",
  "faq.a5":
    "Cryptocurrency only. Pick a coin at checkout and your access unlocks automatically on confirmation.",
  "faq.q6": "Do you offer enterprise plans?",
  "faq.a6":
    "Yes — the Champion tier covers large bot deployments. For anything custom, reach out on Discord and we’ll tailor it.",

  // Support
  "support.title": "Support",
  "support.lead": "We’re one message away.",
  "support.p1":
    "Open a support ticket from the dashboard for account-specific help, or join our Discord for quick questions and community tips.",
};

/* ============================ ITALIANO ============================ */
const it: S = {
  "chrome.badge": "Guida",
  "chrome.title": "Documentazione skyutils",
  "chrome.subtitle":
    "Tutto ciò che ti serve per creare, gestire e padroneggiare i tuoi beam bot — dal primo accesso fino a preset e plugin avanzati.",
  "chrome.search": "Cerca nella guida…",
  "chrome.searchEmpty": "Nessun risultato",
  "chrome.searchEmptyHint":
    "Prova un’altra parola chiave o sfoglia le sezioni.",
  "chrome.onThisPage": "In questa pagina",
  "chrome.nav": "Documentazione",
  "chrome.copy": "Copia",
  "chrome.copied": "Copiato",
  "chrome.backHome": "Torna alla home",
  "chrome.signIn": "Accedi",
  "chrome.openDashboard": "Apri dashboard",
  "chrome.ctaTitle": "Ancora bloccato?",
  "chrome.ctaText":
    "Il nostro team vive su Discord e risponde in fretta. Apri un ticket dalla dashboard o contattaci direttamente.",
  "chrome.ctaButton": "Entra nel Discord",
  "chrome.langLabel": "Lingua",
  "chrome.themeLabel": "Cambia tema",
  "chrome.updated": "Ultimo aggiornamento",

  "intro.title": "Introduzione",
  "intro.lead":
    "skyutils è una piattaforma premium per fare autobeam di account Minecraft. Distribuisci più bot non rilevabili e gestisci tutto da un’unica dashboard ordinata.",
  "intro.p1":
    "Un “beam bot” è un client Minecraft che accede a un server al posto tuo e resta online — muovendosi in modo naturale, rispondendo ai messaggi ed eseguendo i tuoi comandi 24 ore su 24. skyutils esegue ogni bot in un container isolato, così gli account non condividono mai lo stato.",
  "intro.cards.multi.t": "Gestione multi-bot",
  "intro.cards.multi.d":
    "Avvia più bot e gestisci configurazione, proxy e log da un unico posto.",
  "intro.cards.undetected.t": "Pensato per non farsi notare",
  "intro.cards.undetected.d":
    "Proxy a rotazione, movimenti realistici e un’impronta unica per ogni account.",
  "intro.cards.console.t": "Console live",
  "intro.cards.console.d":
    "Guarda l’output di ogni bot in tempo reale mentre si connette, trasmette e risponde in automatico.",
  "intro.cards.deploy.t": "Deploy istantaneo",
  "intro.cards.deploy.d":
    "Dalle credenziali a un bot connesso e attivo in meno di un minuto.",

  "qs.title": "Avvio rapido",
  "qs.lead": "Quattro passi da zero a un bot attivo.",
  "qs.s1.t": "Accedi con Discord",
  "qs.s1.d":
    "Clicca Accedi e autorizza con Discord. Niente password né liste email — il tuo account Discord è la tua identità.",
  "qs.s2.t": "Attiva un piano",
  "qs.s2.d":
    "Apri la sezione Acquista e scegli un piano. Sei nuovo? Riscatta la prova gratuita di 12 ore per provare tutto prima.",
  "qs.s3.t": "Distribuisci il primo bot",
  "qs.s3.d":
    "Vai su Bot → Distribuisci, inserisci i dettagli dell’account e del server e salva.",
  "qs.s4.t": "Premi Avvia e guarda la console",
  "qs.s4.d":
    "Premi Avvia e apri la console live per verificare che il bot si connetta e resti online.",
  "qs.callout.t": "Prova prima di pagare",
  "qs.callout.d":
    "Ogni nuovo account può riscattare una prova gratuita di 12 ore — nessuna cripto richiesta per iniziare.",

  "signin.title": "Accesso",
  "signin.lead": "L’accesso avviene esclusivamente tramite Discord OAuth.",
  "signin.p1":
    "skyutils non memorizza mai le password. Quando clicchi Accedi vieni reindirizzato a Discord per autorizzare l’app e poi riportato alla dashboard. Così il tuo account resta sicuro e l’onboarding è immediato.",
  "signin.list.1": "Niente password, niente liste email, nessun attrito.",
  "signin.list.2":
    "Abbonamento, bot e cronologia di pagamento sono legati alla tua identità Discord.",
  "signin.list.3":
    "Esci quando vuoi da Impostazioni → Account; le sessioni sono per dispositivo.",
  "signin.warn.t": "Non confondere i due accessi",
  "signin.warn.d":
    "L’accesso Discord sblocca la dashboard skyutils. L’account Minecraft usato da un bot è una credenziale separata che imposti al momento del deploy (vedi Modalità di autenticazione).",

  "dash.title": "La dashboard",
  "dash.lead": "Tutto è organizzato in sezioni dedicate nella barra laterale.",
  "dash.rows.overview":
    "Il tuo riepilogo — stato, piano e azioni rapide.",
  "dash.rows.purchase": "Sfoglia i piani, riscatta la prova e paga in cripto.",
  "dash.rows.bots":
    "Distribuisci, configura, avvia/ferma e apri la console live.",
  "dash.rows.billing": "Cronologia pagamenti e gestione abbonamento.",
  "dash.rows.proxies":
    "Aggiungi e ruota i proxy per tenere al sicuro ogni account.",
  "dash.rows.plugins":
    "Componenti opzionali come Discord Spam e Discord Auto-Risposta.",
  "dash.rows.tickets": "Apri un ticket e parla con il team.",

  "bots.title": "Distribuzione dei bot",
  "bots.lead":
    "Un bot è un account Minecraft connesso a un server. Creane quanti il tuo piano consente.",
  "bots.p1":
    "Apri Bot → Distribuisci per creare un bot. I campi lasciati vuoti usano valori predefiniti sensati mostrati come segnaposto. Puoi modificare ogni campo in seguito dalla pagina di dettaglio del bot.",
  "bots.fieldsTitle": "Riferimento dei campi",
  "bots.f.name": "Etichetta descrittiva mostrata nella dashboard.",
  "bots.f.username": "Lo username di gioco con cui il bot si connette.",
  "bots.f.host": "Indirizzo del server, es. play.example.net.",
  "bots.f.port": "Porta del server. Predefinita 25565.",
  "bots.f.version": "Versione di Minecraft che il client deve emulare.",
  "bots.f.auth":
    "Come si autentica il bot — vedi le Modalità di autenticazione qui sotto.",
  "bots.authTitle": "Modalità di autenticazione",
  "bots.auth.offline.t": "Offline (cracked)",
  "bots.auth.offline.d":
    "Per server in modalità offline. Nessun account Mojang/Microsoft richiesto — basta uno username.",
  "bots.auth.ms.t": "Microsoft",
  "bots.auth.ms.d":
    "Accede con un vero account Microsoft/Minecraft per i server premium. Puoi opzionalmente fornire un access token.",
  "bots.auth.ssid.t": "Token SSID",
  "bots.auth.ssid.d":
    "Autenticati con un token di sessione (SSID) se ne hai già uno — comodo per riusare una sessione esistente.",
  "bots.deployTermLabel": "Deploy",
  "bots.tip.t": "Capacità",
  "bots.tip.d":
    "Il tuo piano stabilisce quanti bot girano contemporaneamente e quante bot-ore hai al giorno. Monitora entrambi dall’intestazione Bot.",

  "console.title": "La console live",
  "console.lead":
    "Ogni bot trasmette l’output del suo container al browser in tempo reale.",
  "console.p1":
    "Apri un bot e passa alla console per vederlo lavorare in tempo reale — mentre si connette, si autentica, trasmette il suo messaggio e risponde in automatico ai trigger. La console è una vista live e in sola lettura dell’output del bot, su una connessione persistente: non serve ricaricare.",
  "console.tabLog": "Log live",
  "console.tabReply": "Risposta automatica",
  "console.list.1":
    "Eventi di connessione e autenticazione quando il bot entra nel server.",
  "console.list.2":
    "Ogni trasmissione e risposta automatica inviata dal bot, nell’istante in cui avviene.",
  "console.list.3":
    "Rotazione dei proxy, anti-AFK e attività di riconnessione automatica.",
  "console.tip.t": "In sola lettura per scelta",
  "console.tip.d":
    "La console rispecchia ciò che fa il bot — non è un campo di input. Per cambiare ciò che il bot dice o fa, modifica messaggio, parola trigger e azioni di risposta nella configurazione del bot.",

  "reply.title": "Azioni di risposta",
  "reply.lead": "Dì al bot esattamente cosa fare quando risponde a un trigger.",
  "reply.p1":
    "Le azioni di risposta sono un elenco ordinato di modelli di comando che il bot esegue automaticamente quando rileva la sua parola trigger. Usa il segnaposto {user} per il mittente e {reply} per il testo di risposta che hai configurato. Le azioni vengono eseguite dall’alto verso il basso.",
  "reply.list.1": "{user} — lo username che ha attivato la risposta.",
  "reply.list.2": "{reply} — il messaggio di risposta che hai configurato.",
  "reply.list.3":
    "Senza azioni personalizzate il bot ricade su /msg {user} {reply}.",
  "reply.termLabel": "Azione di risposta",
  "reply.tip.t": "L’ordine conta",
  "reply.tip.d":
    "Le azioni vengono eseguite in sequenza, quindi metti teletrasporti o comandi di preparazione prima del messaggio da inviare.",

  "presets.title": "Preset",
  "presets.lead": "Insiemi riutilizzabili e ordinati di azioni di risposta.",
  "presets.p1":
    "Salva un insieme di azioni di risposta come preset e applicalo a qualsiasi bot con un clic. Un preset può anche includere host, porta e versione del server, così applicandolo imposti anche la connessione.",
  "presets.cards.global.t": "Preset globali",
  "presets.cards.global.d":
    "Curati dagli admin e visibili a tutti — un ottimo punto di partenza.",
  "presets.cards.custom.t": "I miei preset",
  "presets.cards.custom.d":
    "I tuoi insiemi salvati, privati per il tuo account. Fino a 20 azioni per preset.",
  "presets.tip.t": "Salva una volta, riusa ovunque",
  "presets.tip.d":
    "Costruisci il flusso di risposta perfetto su un bot, premi Salva come preset, poi applicalo a tutti i tuoi bot.",

  "proxies.title": "Proxy",
  "proxies.lead": "Aggiungi e ruota i proxy per tenere al sicuro ogni account.",
  "proxies.p1":
    "I proxy instradano il traffico di ogni bot attraverso un IP diverso, così gli account non provengono tutti dallo stesso indirizzo. skyutils li ruota automaticamente per tutti i bot.",
  "proxies.list.1": "Aggiungi i proxy nella sezione Proxy della dashboard.",
  "proxies.list.2":
    "Ogni bot adotta la rotazione automaticamente — nessuna configurazione per bot.",
  "proxies.list.3":
    "Il tuo piano include un’allocazione di proxy (10 / 50 / illimitati).",
  "proxies.warn.t": "Usa proxy di qualità",
  "proxies.warn.d":
    "IP economici, condivisi o segnalati aumentano il rischio di rilevamento. I proxy residenziali o dedicati rendono meglio.",

  "plugins.title": "Plugin",
  "plugins.lead":
    "Componenti opzionali che estendono i bot oltre il beaming.",
  "plugins.p1":
    "I plugin si sbloccano separatamente e appaiono nella barra laterale una volta acquistati. Ognuno gira nel proprio container con supporto proxy e console live, proprio come un bot.",
  "plugins.cards.spam.t": "Discord Spam",
  "plugins.cards.spam.d":
    "Spammer di canali multi-token con rotazione dei token, eliminazione automatica e console live.",
  "plugins.cards.reply.t": "Discord Auto-Risposta",
  "plugins.cards.reply.d":
    "Risponditore DM automatico con modalità DM e Amici e tempistiche umanizzate.",

  "plans.title": "Piani e prezzi",
  "plans.lead":
    "Scegli il livello adatto ai tuoi bot. Aggiorna o riduci quando vuoi.",
  "plans.h.plan": "Piano",
  "plans.h.price": "Prezzo",
  "plans.h.bots": "Bot",
  "plans.h.hours": "Bot-ore",
  "plans.h.proxies": "Proxy",
  "plans.h.speed": "Velocità",
  "plans.starter": "Rookie",
  "plans.pro": "Elite",
  "plans.enterprise": "Champion",
  "plans.month": "/mese",
  "plans.unlimited": "Illimitati",
  "plans.speed.standard": "Standard",
  "plans.speed.fast": "Veloce",
  "plans.speed.max": "Massima",
  "plans.tip.t": "Ancora indeciso?",
  "plans.tip.d":
    "Riscatta prima la prova gratuita di 12 ore — ogni funzione è sbloccata, così puoi testare la tua configurazione prima di pagare.",

  "billing.title": "Fatturazione e pagamenti",
  "billing.lead":
    "Checkout in cripto semplice. Niente fiat, nessuna carta salvata.",
  "billing.p1":
    "Piani e plugin si pagano in criptovaluta. Al checkout scegli una moneta, invii l’importo esatto mostrato all’indirizzo generato e il tuo accesso si sblocca automaticamente appena la transazione viene vista on-chain.",
  "billing.steps.1.t": "Scegli un piano o un plugin",
  "billing.steps.1.d": "Apri Acquista e seleziona ciò che vuoi.",
  "billing.steps.2.t": "Scegli una moneta e paga",
  "billing.steps.2.d":
    "Invia l’importo esatto all’indirizzo mostrato — tieni aperta la finestra.",
  "billing.steps.3.t": "Sblocco automatico",
  "billing.steps.3.d":
    "Una volta confermata on-chain, il piano o il plugin si attiva all’istante.",
  "billing.list.1":
    "La fatturazione è in USD; i prezzi possono essere mostrati nella tua valuta.",
  "billing.list.2":
    "I piani si rinnovano ogni mese. Disdici quando vuoi dalla dashboard.",
  "billing.list.3":
    "Dopo la disdetta mantieni l’accesso fino alla fine del periodo di fatturazione in corso.",
  "billing.warn.t": "Invia l’importo esatto",
  "billing.warn.d":
    "I pagamenti in cripto vengono abbinati per importo. Inviare un valore diverso può ritardare o far mancare l’abbinamento — copia l’importo e l’indirizzo mostrati.",

  "safety.title": "Sicurezza degli account",
  "safety.lead": "Come skyutils tiene i bot sotto le soglie di rilevamento.",
  "safety.p1":
    "Nessuna automazione è mai sicura al 100%, ma skyutils è progettato per mimetizzarsi. Combina queste pratiche per ridurre al minimo il rischio.",
  "safety.list.1": "Proxy a rotazione, così gli account non condividono un IP.",
  "safety.list.2": "Movimenti realistici e schemi anti-AFK.",
  "safety.list.3": "Un’impronta unica per ogni account.",
  "safety.list.4": "Bot-ore ragionevoli invece di 24/7 su account nuovi.",
  "safety.tip.t": "Riscalda gli account nuovi",
  "safety.tip.d":
    "Inizia i nuovi account con sessioni più brevi e attività leggera, poi aumenta gradualmente.",

  "faq.title": "FAQ",
  "faq.lead": "Risposte rapide alle domande comuni.",
  "faq.q1": "Cos’è esattamente skyutils?",
  "faq.a1":
    "Una piattaforma che esegue bot Minecraft pensati per fare beam passivo degli account. Gestisci i bot — credenziali, proxy, comportamenti e log — da un’unica dashboard.",
  "faq.q2": "I miei account verranno bannati?",
  "faq.a2":
    "Ogni bot usa proxy a rotazione, movimenti realistici e un’impronta unica. Nessuna automazione è sicura al 100%, ma skyutils è costruito per restare sotto le soglie di rilevamento sui server principali.",
  "faq.q3": "Come accedo?",
  "faq.a3":
    "Esclusivamente tramite Discord OAuth — niente password né liste email.",
  "faq.q4": "Posso disdire l’abbonamento?",
  "faq.a4":
    "Sì. I piani sono mensili e puoi disdire quando vuoi; mantieni l’accesso fino alla fine del periodo in corso.",
  "faq.q5": "Quali metodi di pagamento accettate?",
  "faq.a5":
    "Solo criptovaluta. Scegli una moneta al checkout e il tuo accesso si sblocca automaticamente alla conferma.",
  "faq.q6": "Offrite piani enterprise?",
  "faq.a6":
    "Sì — il livello Champion copre grandi deployment. Per qualcosa su misura, scrivici su Discord e lo creeremo insieme.",

  "support.title": "Supporto",
  "support.lead": "Siamo a un messaggio di distanza.",
  "support.p1":
    "Apri un ticket dalla dashboard per assistenza specifica sull’account, oppure entra nel nostro Discord per domande veloci e consigli della community.",
};

/* ============================ РУССКИЙ ============================ */
const ru: S = {
  "chrome.badge": "Документы",
  "chrome.title": "Документация skyutils",
  "chrome.subtitle":
    "Всё необходимое, чтобы создавать, запускать и осваивать ваших beam-ботов — от первого входа до продвинутых пресетов и плагинов.",
  "chrome.search": "Поиск по документации…",
  "chrome.searchEmpty": "Ничего не найдено",
  "chrome.searchEmptyHint":
    "Попробуйте другое ключевое слово или просмотрите разделы.",
  "chrome.onThisPage": "На этой странице",
  "chrome.nav": "Документация",
  "chrome.copy": "Копировать",
  "chrome.copied": "Скопировано",
  "chrome.backHome": "На главную",
  "chrome.signIn": "Войти",
  "chrome.openDashboard": "Открыть панель",
  "chrome.ctaTitle": "Всё ещё не получается?",
  "chrome.ctaText":
    "Наша команда живёт в Discord и отвечает быстро. Откройте тикет из панели или напишите нам напрямую.",
  "chrome.ctaButton": "Зайти в Discord",
  "chrome.langLabel": "Язык",
  "chrome.themeLabel": "Сменить тему",
  "chrome.updated": "Последнее обновление",

  "intro.title": "Введение",
  "intro.lead":
    "skyutils — премиум-платформа для автобима аккаунтов Minecraft. Разверните несколько незаметных ботов и управляйте всем из одной аккуратной панели.",
  "intro.p1":
    "«Beam-бот» — это клиент Minecraft, который заходит на сервер вместо вас и остаётся онлайн — двигается естественно, отвечает на сообщения и выполняет ваши команды круглосуточно. skyutils запускает каждого бота в отдельном изолированном контейнере, поэтому аккаунты никогда не делят состояние.",
  "intro.cards.multi.t": "Управление несколькими ботами",
  "intro.cards.multi.d":
    "Запускайте несколько ботов и управляйте их конфигурацией, прокси и логами из одного места.",
  "intro.cards.undetected.t": "Создан, чтобы оставаться незаметным",
  "intro.cards.undetected.d":
    "Ротация прокси, человекоподобные движения и уникальный отпечаток для каждого аккаунта.",
  "intro.cards.console.t": "Живая консоль",
  "intro.cards.console.d":
    "Смотрите вывод каждого бота в реальном времени, пока он подключается, рассылает сообщения и автоматически отвечает.",
  "intro.cards.deploy.t": "Мгновенный запуск",
  "intro.cards.deploy.d":
    "От учётных данных до подключённого бота — меньше чем за минуту.",

  "qs.title": "Быстрый старт",
  "qs.lead": "Четыре шага от нуля до работающего бота.",
  "qs.s1.t": "Войдите через Discord",
  "qs.s1.d":
    "Нажмите «Войти» и авторизуйтесь через Discord. Нет паролей и списков email — ваш аккаунт Discord и есть ваша личность.",
  "qs.s2.t": "Активируйте тариф",
  "qs.s2.d":
    "Откройте раздел «Покупка» и выберите тариф. Впервые здесь? Активируйте бесплатный 12-часовой пробный период, чтобы сначала всё попробовать.",
  "qs.s3.t": "Разверните первого бота",
  "qs.s3.d":
    "Перейдите в «Боты» → «Развернуть», заполните данные аккаунта и сервера и сохраните.",
  "qs.s4.t": "Нажмите «Старт» и смотрите консоль",
  "qs.s4.d":
    "Нажмите «Старт» и откройте живую консоль, чтобы убедиться, что бот подключается и остаётся онлайн.",
  "qs.callout.t": "Попробуйте до покупки",
  "qs.callout.d":
    "Каждый новый аккаунт может активировать один бесплатный 12-часовой пробный период — крипта для старта не нужна.",

  "signin.title": "Вход",
  "signin.lead": "Доступ осуществляется исключительно через Discord OAuth.",
  "signin.p1":
    "skyutils никогда не хранит пароли. Когда вы нажимаете «Войти», вас перенаправляет в Discord для авторизации приложения, а затем возвращает в панель. Так ваш аккаунт остаётся в безопасности, а вход — мгновенным.",
  "signin.list.1": "Нет паролей, нет списков email, нет лишних барьеров.",
  "signin.list.2":
    "Подписка, боты и история платежей привязаны к вашей личности в Discord.",
  "signin.list.3":
    "Выйти можно в любой момент в «Настройки» → «Аккаунт»; сессии раздельные для каждого устройства.",
  "signin.warn.t": "Не путайте два входа",
  "signin.warn.d":
    "Вход через Discord открывает панель skyutils. Аккаунт Minecraft, который использует бот, — это отдельные данные, задаваемые при развёртывании бота (см. «Режимы авторизации»).",

  "dash.title": "Панель управления",
  "dash.lead": "Всё разложено по отдельным разделам в боковом меню.",
  "dash.rows.overview":
    "Ваши боты с первого взгляда — статус, тариф и быстрые действия.",
  "dash.rows.purchase":
    "Просмотр тарифов, активация пробного периода и оплата криптой.",
  "dash.rows.bots":
    "Развёртывание, настройка, старт/стоп и открытие живой консоли.",
  "dash.rows.billing": "История платежей и управление подпиской.",
  "dash.rows.proxies":
    "Добавление и ротация прокси для безопасности каждого аккаунта.",
  "dash.rows.plugins":
    "Дополнительные модули, такие как Discord Спам и Discord Авто-ответ.",
  "dash.rows.tickets": "Откройте тикет и общайтесь с командой.",

  "bots.title": "Развёртывание ботов",
  "bots.lead":
    "Бот — это один аккаунт Minecraft, подключённый к одному серверу. Создавайте столько, сколько позволяет тариф.",
  "bots.p1":
    "Откройте «Боты» → «Развернуть», чтобы создать бота. Пустые поля используют разумные значения по умолчанию, показанные как подсказки. Любое поле можно изменить позже на странице бота.",
  "bots.fieldsTitle": "Справочник полей",
  "bots.f.name": "Понятное имя, отображаемое в панели.",
  "bots.f.username": "Игровой ник, с которым подключается бот.",
  "bots.f.host": "Адрес сервера, напр. play.example.net.",
  "bots.f.port": "Порт сервера. По умолчанию 25565.",
  "bots.f.version": "Версия Minecraft, которую должен эмулировать клиент.",
  "bots.f.auth": "Как бот авторизуется — см. «Режимы авторизации» ниже.",
  "bots.authTitle": "Режимы авторизации",
  "bots.auth.offline.t": "Offline (пиратка)",
  "bots.auth.offline.d":
    "Для серверов в офлайн-режиме. Аккаунт Mojang/Microsoft не нужен — только ник.",
  "bots.auth.ms.t": "Microsoft",
  "bots.auth.ms.d":
    "Вход с настоящим аккаунтом Microsoft/Minecraft для премиум-серверов. По желанию можно указать access-токен.",
  "bots.auth.ssid.t": "SSID-токен",
  "bots.auth.ssid.d":
    "Авторизуйтесь токеном сессии (SSID), если он у вас уже есть — удобно для повторного использования сессии.",
  "bots.deployTermLabel": "Развёртывание",
  "bots.tip.t": "Ёмкость",
  "bots.tip.d":
    "Тариф определяет, сколько ботов работает одновременно и сколько бот-часов в день вам доступно. Следите за обоими в шапке раздела «Боты».",

  "console.title": "Живая консоль",
  "console.lead":
    "Каждый бот транслирует вывод своего контейнера в браузер в реальном времени.",
  "console.p1":
    "Откройте любого бота и перейдите в консоль, чтобы видеть его работу в реальном времени — как он подключается, проходит авторизацию, рассылает своё сообщение и автоматически отвечает на триггеры. Консоль — это живой просмотр вывода бота только для чтения по постоянному соединению, перезагрузка не нужна.",
  "console.tabLog": "Живой лог",
  "console.tabReply": "Автоответ",
  "console.list.1":
    "События подключения и авторизации, когда бот заходит на сервер.",
  "console.list.2":
    "Каждая рассылка и автоответ бота — в момент отправки.",
  "console.list.3":
    "Ротация прокси, анти-AFK и автоматические переподключения.",
  "console.tip.t": "Только для чтения — так задумано",
  "console.tip.d":
    "Консоль отражает то, что делает бот, — это не поле ввода. Чтобы изменить, что бот говорит или делает, отредактируйте сообщение, триггерное слово и действия ответа в настройках бота.",

  "reply.title": "Действия ответа",
  "reply.lead":
    "Укажите боту, что именно делать, когда он отвечает на триггер.",
  "reply.p1":
    "Действия ответа — это упорядоченный список шаблонов команд, которые бот выполняет автоматически при обнаружении своего триггерного слова. Используйте плейсхолдер {user} для отправителя и {reply} для заданного вами текста ответа. Действия выполняются сверху вниз.",
  "reply.list.1": "{user} — ник, вызвавший ответ.",
  "reply.list.2": "{reply} — заданное вами сообщение ответа.",
  "reply.list.3":
    "Без своих действий бот использует запасной вариант /msg {user} {reply}.",
  "reply.termLabel": "Действие ответа",
  "reply.tip.t": "Порядок важен",
  "reply.tip.d":
    "Действия выполняются последовательно, поэтому ставьте телепорты и подготовительные команды перед сообщением, которое хотите отправить.",

  "presets.title": "Пресеты",
  "presets.lead": "Переиспользуемые упорядоченные наборы действий ответа.",
  "presets.p1":
    "Сохраните набор действий ответа как пресет и применяйте его к любому боту в один клик. Пресет также может нести хост, порт и версию сервера, так что его применение задаёт и подключение.",
  "presets.cards.global.t": "Глобальные пресеты",
  "presets.cards.global.d":
    "Подобраны администраторами и видны всем — отличная отправная точка.",
  "presets.cards.custom.t": "Мои пресеты",
  "presets.cards.custom.d":
    "Ваши сохранённые наборы, видимые только вам. До 20 действий на пресет.",
  "presets.tip.t": "Сохрани раз — используй везде",
  "presets.tip.d":
    "Соберите идеальный сценарий ответа на одном боте, нажмите «Сохранить как пресет» и примените его ко всем вашим ботам.",

  "proxies.title": "Прокси",
  "proxies.lead":
    "Добавляйте и ротируйте прокси, чтобы каждый аккаунт был в безопасности.",
  "proxies.p1":
    "Прокси направляют трафик каждого бота через отдельный IP, чтобы аккаунты не исходили с одного адреса. skyutils автоматически ротирует их по всем вашим ботам.",
  "proxies.list.1": "Добавляйте прокси в разделе «Прокси» панели.",
  "proxies.list.2":
    "Каждый бот подхватывает ротацию автоматически — настройка для каждого бота не нужна.",
  "proxies.list.3": "Ваш тариф включает лимит прокси (10 / 50 / безлимит).",
  "proxies.warn.t": "Используйте качественные прокси",
  "proxies.warn.d":
    "Дешёвые, общие или помеченные IP повышают риск обнаружения. Лучше всего работают резидентные или выделенные прокси.",

  "plugins.title": "Плагины",
  "plugins.lead": "Дополнительные мо��ули, расширяющие ваши боты за пределы бима.",
  "plugins.p1":
    "Плагины открываются отдельно и появляются в боковом меню после покупки. Каждый работает в своём контейнере с поддержкой прокси и живой консолью, как и бот.",
  "plugins.cards.spam.t": "Discord Спам",
  "plugins.cards.spam.d":
    "Мульти-токен спаммер каналов с ротацией токенов, автоудалением и живой консолью.",
  "plugins.cards.reply.t": "Discord Авто-ответ",
  "plugins.cards.reply.d":
    "Автоматический ответчик в ЛС с режимами ЛС и «Друзья» и человекоподобными задержками.",

  "plans.title": "Тарифы и цены",
  "plans.lead":
    "Выберите уровень под ваши нужды. Повышайте или понижайте в любой момент.",
  "plans.h.plan": "Тариф",
  "plans.h.price": "Цена",
  "plans.h.bots": "Боты",
  "plans.h.hours": "Бот-часы",
  "plans.h.proxies": "Прокси",
  "plans.h.speed": "Скорость",
  "plans.starter": "Rookie",
  "plans.pro": "Elite",
  "plans.enterprise": "Champion",
  "plans.month": "/мес",
  "plans.unlimited": "Безлимит",
  "plans.speed.standard": "Стандарт",
  "plans.speed.fast": "Быстрая",
  "plans.speed.max": "Максимум",
  "plans.tip.t": "Ещё не уверены?",
  "plans.tip.d":
    "Сначала активируйте бесплатный 12-часовой пробный период — все функции открыты, чтобы протестировать настройку до оплаты.",

  "billing.title": "Оплата и платежи",
  "billing.lead": "Простая оплата криптой. Без фиата и сохранённых карт.",
  "billing.p1":
    "Тарифы и плагины оплачиваются криптовалютой. На оформлении вы выбираете монету, отправляете точную показанную сумму на сгенерированный адрес, и доступ открывается автоматически, как только транзакция видна в сети.",
  "billing.steps.1.t": "Выберите тариф или плагин",
  "billing.steps.1.d": "Откройте «Покупка» и выберите нужное.",
  "billing.steps.2.t": "Выберите монету и оплатите",
  "billing.steps.2.d":
    "Отправьте точную сумму на показанный адрес — не закрывайте окно.",
  "billing.steps.3.t": "Авто-разблокировка",
  "billing.steps.3.d":
    "После подтверждения в сети тариф или плагин активируется мгновенно.",
  "billing.list.1":
    "Биллинг идёт в USD; цены могут отображаться в вашей валюте.",
  "billing.list.2":
    "Тарифы продлеваются ежемесячно. Отмена в любой момент из панели.",
  "billing.list.3":
    "После отмены доступ сохраняется до конца текущего расчётного периода.",
  "billing.warn.t": "Отправляйте точную сумму",
  "billing.warn.d":
    "Крипто-платежи сопоставляются по сумме. Отправка другого значения может задержать или сорвать сопоставление — копируйте показанные сумму и адрес.",

  "safety.title": "Безопасность аккаунтов",
  "safety.lead": "Как skyutils держит ботов ниже порогов обнаружения.",
  "safety.p1":
    "Ни одна автоматизация не безопасна на 100%, но skyutils спроектирован, чтобы сливаться с фоном. Сочетайте эти практики, чтобы свести риск к минимуму.",
  "safety.list.1": "Ротация прокси, чтобы аккаунты не делили IP.",
  "safety.list.2": "Человекоподобные движения и анти-AFK паттерны.",
  "safety.list.3": "Уникальный отпечаток для каждого аккаунта.",
  "safety.list.4": "Разумные бот-часы вместо 24/7 на свежих аккаунтах.",
  "safety.tip.t": "Прогревайте новые аккаунты",
  "safety.tip.d":
    "Начинайте новые аккаунты с коротких сессий и лёгкой активности, затем постепенно наращивайте.",

  "faq.title": "Частые вопросы",
  "faq.lead": "Быстрые ответы на популярные вопросы.",
  "faq.q1": "Что такое skyutils?",
  "faq.a1":
    "Платформа, которая запускает ботов Minecraft для пассивного бима аккаунтов. Вы управляете всеми вашими ботами — учётными данными, прокси, поведением и логами — из одной панели.",
  "faq.q2": "Не забанят ли мои аккаунты?",
  "faq.a2":
    "Каждый бот использует ротацию прокси, человекоподобные движения и уникальный отпечаток. Ни одна автоматизация не безопасна на 100%, но skyutils создан, чтобы оставаться ниже порогов обнаружения на крупных серверах.",
  "faq.q3": "Как войти?",
  "faq.a3": "Только через Discord OAuth — без паролей и ��писков email.",
  "faq.q4": "Можно ли отменить подписку?",
  "faq.a4":
    "Да. Тарифы оплачиваются помесячно, отменить можно в любой момент; доступ сохраняется до конца текущего периода.",
  "faq.q5": "Какие способы оплаты вы принимаете?",
  "faq.a5":
    "Только криптовалюта. Выберите монету на оформлении, и доступ откроется автоматически после подтверждения.",
  "faq.q6": "Есть ли корпоративные тарифы?",
  "faq.a6":
    "Да — уровень Enterprise рассчитан на большие операции. Для индивидуальных решений напишите в Discord, и мы всё настроим.",

  "support.title": "Поддержка",
  "support.lead": "Мы на расстоянии одного сообщения.",
  "support.p1":
    "Откройте тикет из панели для помощи по вашему аккаунту или зайдите в наш Discord для быстрых вопросов и советов сообщества.",
};

const STRINGS: Record<Language, S> = { en, it, ru };

/* ─── Shared, language-neutral terminal demos ─── */

const TERM_DEPLOY: TermLine[] = [
  { t: "cmd", text: "$ skyutils deploy" },
  { t: "prompt", text: "? name        bot-01" },
  { t: "prompt", text: "? username    Steve_2945" },
  { t: "prompt", text: "? host        play.example.net" },
  { t: "prompt", text: "? port        25565" },
  { t: "prompt", text: "? version     1.20.4" },
  { t: "prompt", text: "? auth        microsoft" },
  { t: "ok", text: "✓ bot saved — press Start to launch" },
];

const TERM_LOG: TermLine[] = [
  { t: "ok", text: "✓ container started   node: eu-west-1" },
  { t: "muted", text: "→ connecting to play.example.net:25565" },
  { t: "ok", text: "✓ authenticated as Steve_2945  (microsoft)" },
  { t: "ok", text: "✓ joined server · 142ms ping" },
  { t: "out", text: "• anti-afk engaged · humanized movement" },
  { t: "out", text: "• proxy 37.48.x.x · rotation active" },
  { t: "chat", text: "[broadcast] 888 to join unstableSMP" },
];

const TERM_REPLY: TermLine[] = [
  { t: "chat", text: "[trigger] <Notch> 888" },
  { t: "muted", text: "→ keyword matched · running reply actions" },
  { t: "out", text: "[bot] /msg Notch add me on dc to join - untualab" },
  { t: "out", text: "[server] → whispered to Notch" },
];

/* ─── Builder: assembles the full doc for a language ─── */

function build(lang: Language): DocsContent {
  const tr = (k: string) => STRINGS[lang][k] ?? STRINGS.en[k] ?? k;

  const chrome: DocsChrome = {
    badge: tr("chrome.badge"),
    title: tr("chrome.title"),
    subtitle: tr("chrome.subtitle"),
    searchPlaceholder: tr("chrome.search"),
    searchEmpty: tr("chrome.searchEmpty"),
    searchEmptyHint: tr("chrome.searchEmptyHint"),
    onThisPage: tr("chrome.onThisPage"),
    navHeading: tr("chrome.nav"),
    copy: tr("chrome.copy"),
    copied: tr("chrome.copied"),
    backHome: tr("chrome.backHome"),
    signIn: tr("chrome.signIn"),
    openDashboard: tr("chrome.openDashboard"),
    ctaTitle: tr("chrome.ctaTitle"),
    ctaText: tr("chrome.ctaText"),
    ctaButton: tr("chrome.ctaButton"),
    langLabel: tr("chrome.langLabel"),
    themeLabel: tr("chrome.themeLabel"),
    updated: tr("chrome.updated"),
  };

  const sections: DocsSection[] = [
    {
      id: "introduction",
      icon: "book",
      title: tr("intro.title"),
      lead: tr("intro.lead"),
      blocks: [
        { kind: "p", text: tr("intro.p1") },
        {
          kind: "cards",
          items: [
            {
              title: tr("intro.cards.multi.t"),
              desc: tr("intro.cards.multi.d"),
            },
            {
              title: tr("intro.cards.undetected.t"),
              desc: tr("intro.cards.undetected.d"),
            },
            {
              title: tr("intro.cards.console.t"),
              desc: tr("intro.cards.console.d"),
            },
            {
              title: tr("intro.cards.deploy.t"),
              desc: tr("intro.cards.deploy.d"),
            },
          ],
        },
      ],
    },
    {
      id: "quick-start",
      icon: "rocket",
      title: tr("qs.title"),
      lead: tr("qs.lead"),
      blocks: [
        {
          kind: "steps",
          items: [
            { title: tr("qs.s1.t"), text: tr("qs.s1.d") },
            { title: tr("qs.s2.t"), text: tr("qs.s2.d") },
            { title: tr("qs.s3.t"), text: tr("qs.s3.d") },
            { title: tr("qs.s4.t"), text: tr("qs.s4.d") },
          ],
        },
        {
          kind: "callout",
          tone: "tip",
          title: tr("qs.callout.t"),
          text: tr("qs.callout.d"),
        },
      ],
    },
    {
      id: "signing-in",
      icon: "login",
      title: tr("signin.title"),
      lead: tr("signin.lead"),
      blocks: [
        { kind: "p", text: tr("signin.p1") },
        {
          kind: "list",
          items: [
            tr("signin.list.1"),
            tr("signin.list.2"),
            tr("signin.list.3"),
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          title: tr("signin.warn.t"),
          text: tr("signin.warn.d"),
        },
      ],
    },
    {
      id: "dashboard",
      icon: "layout",
      title: tr("dash.title"),
      lead: tr("dash.lead"),
      blocks: [
        {
          kind: "fields",
          rows: [
            { name: "Overview", desc: tr("dash.rows.overview") },
            { name: "Purchase", desc: tr("dash.rows.purchase") },
            { name: "Bots", desc: tr("dash.rows.bots") },
            { name: "Billing", desc: tr("dash.rows.billing") },
            { name: "Proxies", desc: tr("dash.rows.proxies") },
            { name: "Plugins", desc: tr("dash.rows.plugins") },
            { name: "Support", desc: tr("dash.rows.tickets") },
          ],
        },
      ],
    },
    {
      id: "deploying-bots",
      icon: "bot",
      title: tr("bots.title"),
      lead: tr("bots.lead"),
      blocks: [
        { kind: "p", text: tr("bots.p1") },
        {
          kind: "terminal",
          tabs: [
            {
              label: tr("bots.deployTermLabel"),
              title: "skyutils — deploy",
              lines: TERM_DEPLOY,
            },
          ],
        },
        {
          kind: "fields",
          rows: [
            { name: "Name", desc: tr("bots.f.name") },
            { name: "Username", desc: tr("bots.f.username") },
            { name: "Host", desc: tr("bots.f.host") },
            { name: "Port", type: "25565", desc: tr("bots.f.port") },
            { name: "Version", desc: tr("bots.f.version") },
            { name: "Auth mode", desc: tr("bots.f.auth") },
          ],
        },
        {
          kind: "cards",
          items: [
            {
              title: tr("bots.auth.offline.t"),
              desc: tr("bots.auth.offline.d"),
            },
            { title: tr("bots.auth.ms.t"), desc: tr("bots.auth.ms.d") },
            { title: tr("bots.auth.ssid.t"), desc: tr("bots.auth.ssid.d") },
          ],
        },
        {
          kind: "callout",
          tone: "info",
          title: tr("bots.tip.t"),
          text: tr("bots.tip.d"),
        },
      ],
    },
    {
      id: "live-console",
      icon: "terminal",
      title: tr("console.title"),
      lead: tr("console.lead"),
      blocks: [
        { kind: "p", text: tr("console.p1") },
        {
          kind: "terminal",
          tabs: [
            {
              label: tr("console.tabLog"),
              title: "bot-01 — live log",
              lines: TERM_LOG,
            },
            {
              label: tr("console.tabReply"),
              title: "bot-01 — auto-reply",
              lines: TERM_REPLY,
            },
          ],
        },
        {
          kind: "list",
          items: [
            tr("console.list.1"),
            tr("console.list.2"),
            tr("console.list.3"),
          ],
        },
        {
          kind: "callout",
          tone: "tip",
          title: tr("console.tip.t"),
          text: tr("console.tip.d"),
        },
      ],
    },
    {
      id: "reply-actions",
      icon: "reply",
      title: tr("reply.title"),
      lead: tr("reply.lead"),
      blocks: [
        { kind: "p", text: tr("reply.p1") },
        {
          kind: "list",
          items: [tr("reply.list.1"), tr("reply.list.2"), tr("reply.list.3")],
        },
        {
          kind: "terminal",
          tabs: [
            {
              label: tr("reply.termLabel"),
              title: "bot-01 — reply action",
              lines: TERM_REPLY,
            },
          ],
        },
        {
          kind: "callout",
          tone: "tip",
          title: tr("reply.tip.t"),
          text: tr("reply.tip.d"),
        },
      ],
    },
    {
      id: "presets",
      icon: "layers",
      title: tr("presets.title"),
      lead: tr("presets.lead"),
      blocks: [
        { kind: "p", text: tr("presets.p1") },
        {
          kind: "cards",
          items: [
            {
              title: tr("presets.cards.global.t"),
              desc: tr("presets.cards.global.d"),
            },
            {
              title: tr("presets.cards.custom.t"),
              desc: tr("presets.cards.custom.d"),
            },
          ],
        },
        {
          kind: "callout",
          tone: "tip",
          title: tr("presets.tip.t"),
          text: tr("presets.tip.d"),
        },
      ],
    },
    {
      id: "proxies",
      icon: "shield",
      title: tr("proxies.title"),
      lead: tr("proxies.lead"),
      blocks: [
        { kind: "p", text: tr("proxies.p1") },
        {
          kind: "list",
          items: [
            tr("proxies.list.1"),
            tr("proxies.list.2"),
            tr("proxies.list.3"),
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          title: tr("proxies.warn.t"),
          text: tr("proxies.warn.d"),
        },
      ],
    },
    {
      id: "plugins",
      icon: "puzzle",
      title: tr("plugins.title"),
      lead: tr("plugins.lead"),
      blocks: [
        { kind: "p", text: tr("plugins.p1") },
        {
          kind: "cards",
          items: [
            {
              title: tr("plugins.cards.spam.t"),
              desc: tr("plugins.cards.spam.d"),
            },
            {
              title: tr("plugins.cards.reply.t"),
              desc: tr("plugins.cards.reply.d"),
            },
          ],
        },
      ],
    },
    {
      id: "plans",
      icon: "credit",
      title: tr("plans.title"),
      lead: tr("plans.lead"),
      blocks: [
        {
          kind: "table",
          highlight: 1,
          headers: [
            tr("plans.h.plan"),
            tr("plans.h.price"),
            tr("plans.h.bots"),
            tr("plans.h.hours"),
            tr("plans.h.proxies"),
            tr("plans.h.speed"),
          ],
          rows: [
            [
              tr("plans.starter"),
              `$14.99${tr("plans.month")}`,
              "1",
              "5h",
              "10",
              tr("plans.speed.standard"),
            ],
            [
              tr("plans.pro"),
              `$29.99${tr("plans.month")}`,
              "5",
              "12h",
              "50",
              tr("plans.speed.fast"),
            ],
            [
              tr("plans.enterprise"),
              `$79.99${tr("plans.month")}`,
              "25",
              tr("plans.unlimited"),
              tr("plans.unlimited"),
              tr("plans.speed.max"),
            ],
          ],
        },
        {
          kind: "callout",
          tone: "tip",
          title: tr("plans.tip.t"),
          text: tr("plans.tip.d"),
        },
      ],
    },
    {
      id: "billing",
      icon: "wallet",
      title: tr("billing.title"),
      lead: tr("billing.lead"),
      blocks: [
        { kind: "p", text: tr("billing.p1") },
        {
          kind: "steps",
          items: [
            { title: tr("billing.steps.1.t"), text: tr("billing.steps.1.d") },
            { title: tr("billing.steps.2.t"), text: tr("billing.steps.2.d") },
            { title: tr("billing.steps.3.t"), text: tr("billing.steps.3.d") },
          ],
        },
        {
          kind: "list",
          items: [
            tr("billing.list.1"),
            tr("billing.list.2"),
            tr("billing.list.3"),
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          title: tr("billing.warn.t"),
          text: tr("billing.warn.d"),
        },
      ],
    },
    {
      id: "account-safety",
      icon: "lock",
      title: tr("safety.title"),
      lead: tr("safety.lead"),
      blocks: [
        { kind: "p", text: tr("safety.p1") },
        {
          kind: "list",
          items: [
            tr("safety.list.1"),
            tr("safety.list.2"),
            tr("safety.list.3"),
            tr("safety.list.4"),
          ],
        },
        {
          kind: "callout",
          tone: "tip",
          title: tr("safety.tip.t"),
          text: tr("safety.tip.d"),
        },
      ],
    },
    {
      id: "faq",
      icon: "help",
      title: tr("faq.title"),
      lead: tr("faq.lead"),
      blocks: [
        {
          kind: "fields",
          rows: [
            { name: tr("faq.q1"), desc: tr("faq.a1") },
            { name: tr("faq.q2"), desc: tr("faq.a2") },
            { name: tr("faq.q3"), desc: tr("faq.a3") },
            { name: tr("faq.q4"), desc: tr("faq.a4") },
            { name: tr("faq.q5"), desc: tr("faq.a5") },
            { name: tr("faq.q6"), desc: tr("faq.a6") },
          ],
        },
      ],
    },
    {
      id: "support",
      icon: "ticket",
      title: tr("support.title"),
      lead: tr("support.lead"),
      blocks: [{ kind: "p", text: tr("support.p1") }],
    },
  ];

  return { chrome, sections };
}

const CACHE: Partial<Record<Language, DocsContent>> = {};

/** Get the full, translated documentation tree for a language (memoized). */
export function getDocsContent(lang: Language): DocsContent {
  return (CACHE[lang] ??= build(lang));
}

/** Discord invite used by the docs CTA (skyutils's own community). */
export const DOCS_DISCORD_URL = "https://discord.gg/sTTw2czD4k";
