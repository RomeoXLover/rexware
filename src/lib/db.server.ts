import process from "node:process";
import crypto from "node:crypto";
import pg from "pg";

// ---------------------------------------------------------------------------
// PostgreSQL database layer (server-only).
//
// The web app and the Discord bot run in separate containers but share this
// same Postgres instance (the `db` service in docker-compose, reachable only
// on the internal Docker network — never exposed to the host/internet).
//
// Connection is configured via DATABASE_URL, e.g.
//   postgres://skyutils:password@db:5432/skyutils
// ---------------------------------------------------------------------------

const { Pool } = pg;

// BIGINT (oid 20) comes back from pg as a string by default. All of our BIGINT
// columns are millisecond epoch timestamps that fit in a JS safe integer, so
// parse them back to numbers to match the behaviour the codebase expects.
pg.types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));

let _pool: pg.Pool | null = null;
let _schemaReady: Promise<void> | null = null;

export function getPool(): pg.Pool {
  if (_pool) return _pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Point it at the Postgres container, e.g. postgres://skyutils:password@db:5432/skyutils",
    );
  }

  _pool = new Pool({
    connectionString,
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  _pool.on("error", (err) => {
    console.error("[v0] Unexpected Postgres pool error:", err);
  });

  return _pool;
}

/**
 * Lazily create the schema + seed once per process. Every query helper awaits
 * this so callers never have to think about migration ordering.
 */
export async function ensureSchema(): Promise<void> {
  if (_schemaReady) return _schemaReady;
  _schemaReady = (async () => {
    const pool = getPool();
    await migrate(pool);
    await seedPlans(pool);
  })().catch((err) => {
    _schemaReady = null;
    throw err;
  });
  return _schemaReady;
}

// ---------------------------------------------------------------------------
// Query helpers — all async. Accept either native $1,$2 placeholders or the
// SQLite-style `?` placeholders used throughout the repo layer; `?` markers are
// translated to $1,$2,... left-to-right. (SQL string literals in this codebase
// never contain a literal `?`, so a straight positional replace is safe.)
// ---------------------------------------------------------------------------

function toPgPlaceholders(sql: string): string {
  if (!sql.includes("?")) return sql;
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await ensureSchema();
  const res = await getPool().query(toPgPlaceholders(sql), params);
  return res.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(sql, params);
  return rows[0];
}

export async function execute(
  sql: string,
  params: unknown[] = [],
): Promise<{ rowCount: number }> {
  await ensureSchema();
  const res = await getPool().query(toPgPlaceholders(sql), params);
  return { rowCount: res.rowCount ?? 0 };
}

/** Run a set of statements inside a single transaction. */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Schema migration.
// ---------------------------------------------------------------------------

async function migrate(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      username        TEXT NOT NULL,
      global_name     TEXT,
      mc_username     TEXT,
      avatar_url      TEXT,
      email           TEXT,
      is_admin        SMALLINT NOT NULL DEFAULT 0,
      is_banned       SMALLINT NOT NULL DEFAULT 0,
      discord_joined  SMALLINT NOT NULL DEFAULT 0,
      created_at      BIGINT NOT NULL,
      last_login_at   BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plans (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      description     TEXT NOT NULL,
      price_usd       DOUBLE PRECISION NOT NULL,
      interval        TEXT NOT NULL DEFAULT 'month',
      max_bots        INTEGER NOT NULL DEFAULT 0,
      max_proxies     INTEGER NOT NULL DEFAULT 0,
      bot_hours       INTEGER NOT NULL DEFAULT -1,
      features        TEXT NOT NULL DEFAULT '[]',
      is_active       SMALLINT NOT NULL DEFAULT 1,
      is_hidden       SMALLINT NOT NULL DEFAULT 0,
      is_trial        SMALLINT NOT NULL DEFAULT 0,
      sort_order      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS trial_redemptions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL UNIQUE,
      ip          TEXT NOT NULL,
      redeemed_at BIGINT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_trial_ip ON trial_redemptions(ip);

    CREATE TABLE IF NOT EXISTS subscriptions (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      plan_id         TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      started_at      BIGINT,
      expires_at      BIGINT,
      created_at      BIGINT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (plan_id) REFERENCES plans(id)
    );
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

    CREATE TABLE IF NOT EXISTS payments (
      id                TEXT PRIMARY KEY,
      user_id           TEXT NOT NULL,
      plan_id           TEXT,
      plugin_id         TEXT,
      kind              TEXT NOT NULL DEFAULT 'subscription',
      subscription_id   TEXT,
      coin              TEXT NOT NULL,
      amount_usd        DOUBLE PRECISION NOT NULL,
      amount_crypto     TEXT,
      received_crypto   TEXT,
      pay_address       TEXT,
      status            TEXT NOT NULL DEFAULT 'waiting',
      txid              TEXT,
      notified_at       BIGINT,           -- set when bot has notified player in-game
      created_at        BIGINT NOT NULL,
      updated_at        BIGINT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

    CREATE TABLE IF NOT EXISTS notifications (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      type        TEXT NOT NULL DEFAULT 'info',
      title       TEXT NOT NULL,
      body        TEXT,
      read        SMALLINT NOT NULL DEFAULT 0,
      created_at  BIGINT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id               TEXT PRIMARY KEY,
      notify_payments       SMALLINT NOT NULL DEFAULT 1,
      notify_bots           SMALLINT NOT NULL DEFAULT 1,
      notify_announcements  SMALLINT NOT NULL DEFAULT 1,
      theme                 TEXT NOT NULL DEFAULT 'dark',
      updated_at            BIGINT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_audit (
      id          TEXT PRIMARY KEY,
      actor_id    TEXT NOT NULL,
      action      TEXT NOT NULL,
      target_id   TEXT,
      detail      TEXT,
      is_owner    SMALLINT NOT NULL DEFAULT 0,
      created_at  BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at);

    CREATE TABLE IF NOT EXISTS banned_ips (
      ip          TEXT PRIMARY KEY,
      reason      TEXT,
      banned_by   TEXT NOT NULL,
      created_at  BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_ips (
      user_id     TEXT NOT NULL,
      ip          TEXT NOT NULL,
      first_seen  BIGINT NOT NULL,
      last_seen   BIGINT NOT NULL,
      hits        INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, ip)
    );
    CREATE INDEX IF NOT EXISTS idx_user_ips_user ON user_ips(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_ips_ip ON user_ips(ip);

    CREATE TABLE IF NOT EXISTS proxies (
      id                TEXT PRIMARY KEY,
      host              TEXT NOT NULL,
      port              INTEGER NOT NULL,
      username          TEXT,
      password          TEXT,
      protocol          TEXT NOT NULL DEFAULT 'http',
      label             TEXT,
      assigned_user_id  TEXT,
      created_at        BIGINT NOT NULL,
      FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_proxies_user ON proxies(assigned_user_id);

    CREATE TABLE IF NOT EXISTS tickets (
      id                TEXT PRIMARY KEY,
      user_id           TEXT NOT NULL,
      discord_user_id   TEXT NOT NULL,
      discord_user_tag  TEXT NOT NULL,
      channel_id        TEXT,
      subject           TEXT NOT NULL,
      category          TEXT NOT NULL DEFAULT 'general',
      status            TEXT NOT NULL DEFAULT 'open',
      priority          TEXT NOT NULL DEFAULT 'normal',
      source            TEXT NOT NULL DEFAULT 'discord',
      closed_by         TEXT,
      closed_at         BIGINT,
      claimed_by        TEXT,
      created_at        BIGINT NOT NULL,
      updated_at        BIGINT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets(channel_id);

    CREATE TABLE IF NOT EXISTS ticket_messages (
      id              TEXT PRIMARY KEY,
      ticket_id       TEXT NOT NULL,
      author_id       TEXT NOT NULL,
      author_tag      TEXT NOT NULL,
      content         TEXT NOT NULL,
      attachments     TEXT,
      is_staff        SMALLINT NOT NULL DEFAULT 0,
      created_at      BIGINT NOT NULL,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id);

    CREATE TABLE IF NOT EXISTS user_warns (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      actor_id    TEXT NOT NULL,
      reason      TEXT NOT NULL,
      created_at  BIGINT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_warns_user ON user_warns(user_id);

    CREATE TABLE IF NOT EXISTS user_notes (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      actor_id    TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  BIGINT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_notes_user ON user_notes(user_id);

    CREATE TABLE IF NOT EXISTS bot_settings (
      key         TEXT PRIMARY KEY,
      value       TEXT,
      updated_at  BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dm_queue (
      id            TEXT PRIMARY KEY,
      discord_id    TEXT NOT NULL,
      title         TEXT NOT NULL,
      body          TEXT NOT NULL,
      url           TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      created_at    BIGINT NOT NULL,
      sent_at       BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_dm_queue_status ON dm_queue(status);

    CREATE TABLE IF NOT EXISTS plugin_purchases (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      plugin_id   TEXT NOT NULL,
      amount_usd  DOUBLE PRECISION NOT NULL DEFAULT 0,
      payment_id  TEXT,
      created_at  BIGINT NOT NULL,
      UNIQUE(user_id, plugin_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_plugin_purchases_user ON plugin_purchases(user_id);

    CREATE TABLE IF NOT EXISTS plugin_configs (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      plugin_id   TEXT NOT NULL,
      config      TEXT NOT NULL DEFAULT '{}',
      updated_at  BIGINT NOT NULL,
      UNIQUE(user_id, plugin_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_plugin_configs_user ON plugin_configs(user_id);

    CREATE TABLE IF NOT EXISTS plugin_runs (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      plugin_id       TEXT NOT NULL,
      config_snapshot TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      container_id    TEXT,
      error           TEXT,
      created_at      BIGINT NOT NULL,
      updated_at      BIGINT NOT NULL,
      stopped_at      BIGINT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_plugin_runs_user ON plugin_runs(user_id);
    CREATE INDEX IF NOT EXISTS idx_plugin_runs_status ON plugin_runs(status);

    CREATE TABLE IF NOT EXISTS plugin_run_logs (
      id          BIGSERIAL PRIMARY KEY,
      run_id      TEXT NOT NULL,
      ts          TEXT NOT NULL,
      level       TEXT NOT NULL DEFAULT 'INFO',
      msg         TEXT NOT NULL,
      created_at  BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plugin_run_logs_run ON plugin_run_logs(run_id, id);

    CREATE TABLE IF NOT EXISTS plugin_run_events (
      id          BIGSERIAL PRIMARY KEY,
      run_id      TEXT NOT NULL,
      kind        TEXT NOT NULL DEFAULT 'incoming',
      author      TEXT NOT NULL DEFAULT '',
      author_id   TEXT NOT NULL DEFAULT '',
      content     TEXT NOT NULL DEFAULT '',
      ts          TEXT NOT NULL DEFAULT '',
      created_at  BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plugin_run_events_run ON plugin_run_events(run_id, id);

    CREATE TABLE IF NOT EXISTS plugin_captchas (
      id          TEXT PRIMARY KEY,
      run_id      TEXT NOT NULL,
      sitekey     TEXT NOT NULL DEFAULT '',
      rqdata      TEXT,
      service     TEXT NOT NULL DEFAULT 'hcaptcha',
      status      TEXT NOT NULL DEFAULT 'pending',
      solution    TEXT,
      created_at  BIGINT NOT NULL,
      updated_at  BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plugin_captchas_run ON plugin_captchas(run_id, status, id);

    CREATE TABLE IF NOT EXISTS plugin_outbox (
      id          TEXT PRIMARY KEY,
      run_id      TEXT NOT NULL,
      target_id   TEXT NOT NULL DEFAULT '',
      content     TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  BIGINT NOT NULL,
      updated_at  BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plugin_outbox_run ON plugin_outbox(run_id, status, id);

    CREATE TABLE IF NOT EXISTS bots (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      name            TEXT NOT NULL,
      mc_username     TEXT NOT NULL,
      server_host     TEXT NOT NULL,
      server_port     INTEGER NOT NULL DEFAULT 25565,
      mc_version      TEXT NOT NULL DEFAULT '1.21.1',
      auth_mode       TEXT NOT NULL DEFAULT 'offline',
      access_token    TEXT,
      ssid            TEXT,
      uuid            TEXT,
      auth_expires_at BIGINT,
      proxy           TEXT,
      message            TEXT,
      reply              TEXT,
      trigger_keyword    TEXT,
      webhook_url        TEXT,
      message_interval   INTEGER,
      reply_delay        INTEGER,
      reply_cooldown     INTEGER,
      afk_interval       INTEGER,
      reconnect_delay    INTEGER,
      inactivity_timeout INTEGER,
      created_at      BIGINT NOT NULL,
      updated_at      BIGINT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_bots_user ON bots(user_id);

    CREATE TABLE IF NOT EXISTS bot_runs (
      id              TEXT PRIMARY KEY,
      bot_id          TEXT,
      user_id         TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      container_id    TEXT,
      error           TEXT,
      created_at      BIGINT NOT NULL,
      updated_at      BIGINT NOT NULL,
      stopped_at      BIGINT,
      FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_bot_runs_bot ON bot_runs(bot_id);
    CREATE INDEX IF NOT EXISTS idx_bot_runs_status ON bot_runs(status);

    CREATE TABLE IF NOT EXISTS redeem_keys (
      id            TEXT PRIMARY KEY,
      code          TEXT NOT NULL,
      type          TEXT NOT NULL,
      plan_id       TEXT,
      plugin_id     TEXT,
      duration_days INTEGER,
      note          TEXT,
      redeemed_by   TEXT,
      redeemed_at   BIGINT,
      created_by    TEXT NOT NULL,
      created_at    BIGINT NOT NULL,
      FOREIGN KEY (plan_id) REFERENCES plans(id),
      FOREIGN KEY (redeemed_by) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_redeem_keys_code ON redeem_keys(code);

    CREATE TABLE IF NOT EXISTS ai_chat_users (
      user_id     TEXT PRIMARY KEY,
      enabled     SMALLINT NOT NULL DEFAULT 1,
      updated_at  BIGINT NOT NULL
    );
  `);

  // Incremental column migrations — safe on existing Postgres DBs.
  await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS bot_hours INTEGER NOT NULL DEFAULT -1`);
  await pool.query(`ALTER TABLE admin_audit ADD COLUMN IF NOT EXISTS is_owner SMALLINT NOT NULL DEFAULT 0`);

  // Master keys are multi-use, so drop the old UNIQUE constraint on redeem_keys.code.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'redeem_keys'
          AND c.conname = 'redeem_keys_code_key'
      ) THEN
        ALTER TABLE redeem_keys DROP CONSTRAINT redeem_keys_code_key;
      END IF;
    END
    $$`);

  // Seed the master key if it doesn't already exist. This key is reusable —
  // anyone who redeems it gets full admin access + the admin plan.
  const existing = await pool.query(`SELECT 1 FROM redeem_keys WHERE code = $1`, ["ROMEOXLOVER"]);
  if (existing.rowCount === 0) {
    // Fix any existing row stored with the old casing (code always uppercases input).
    await pool.query(`UPDATE redeem_keys SET code = 'ROMEOXLOVER' WHERE code = 'RomeoXLover'`);
    const checkFixed = await pool.query(`SELECT 1 FROM redeem_keys WHERE code = $1`, ["ROMEOXLOVER"]);
    if (checkFixed.rowCount === 0) {
      await pool.query(`
        INSERT INTO redeem_keys (id, code, type, note, created_by, created_at)
        VALUES ($1, $2, 'master', 'Master key — grants admin access to anyone who redeems it', $3, $4)
      `, [crypto.randomUUID(), "ROMEOXLOVER", "system", Date.now()]);
    }
  }

  // Bot-run history must OUTLIVE the bot it belongs to. Originally bot_runs.bot_id
  // had ON DELETE CASCADE, so deleting + recreating a bot wiped a user's run
  // history and reset their daily bot-hours quota (letting a 5h plan run ~10h in
  // one day by deleting the bot between runs). Detach the rows on bot deletion
  // instead of removing them: keep bot_id but make it nullable + SET NULL, so the
  // per-user quota in usedMsToday() stays accurate. Idempotent.
  await pool.query(`ALTER TABLE bot_runs ALTER COLUMN bot_id DROP NOT NULL`);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'bot_runs'
          AND c.contype = 'f'
          AND c.conname = 'bot_runs_bot_id_fkey'
          AND c.confdeltype <> 'n'  -- anything other than SET NULL
      ) THEN
        ALTER TABLE bot_runs DROP CONSTRAINT bot_runs_bot_id_fkey;
        ALTER TABLE bot_runs ADD CONSTRAINT bot_runs_bot_id_fkey
          FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);
  await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_hidden SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_trial SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'discord'`);
  await pool.query(`ALTER TABLE ticket_messages ADD COLUMN IF NOT EXISTS attachments TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_otp_secret TEXT`);
  // Minecraft username — set by the bot when it detects the player's skin.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mc_username TEXT`);
  // Referral program + beta access + spendable credit balance.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_beta SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS credit_usd DOUBLE PRECISION NOT NULL DEFAULT 0`);
  // Extra deployable bot slots purchased à la carte ($5 each, lifetime). Added
  // on top of the active plan's max_bots cap. Only purchasable by paying users.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_bot_slots INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)`);
  // Credit reserved/spent against an invoice at checkout (refunded if cancelled).
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS credit_applied DOUBLE PRECISION NOT NULL DEFAULT 0`);
  // Number of bot slots bought on a 'slot' kind invoice (0 for other kinds).
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS slot_qty INTEGER NOT NULL DEFAULT 0`);
  // Bot notification timestamp — set after bot DMs the player in-game about a paid invoice.
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS notified_at BIGINT`);
  // Referral credit ledger — one row per paid invoice (idempotent via UNIQUE payment_id).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_credits (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      source_user_id  TEXT NOT NULL,
      payment_id      TEXT NOT NULL UNIQUE,
      amount_usd      DOUBLE PRECISION NOT NULL,
      created_at      BIGINT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_referral_credits_user ON referral_credits(user_id)`);
  // Bot behaviour config — nullable so an empty value falls back to the Rust default.
  await pool.query(`ALTER TABLE bots ADD COLUMN IF NOT EXISTS message TEXT`);
  await pool.query(`ALTER TABLE bots ADD COLUMN IF NOT EXISTS reply TEXT`);
  await pool.query(`ALTER TABLE bots ADD COLUMN IF NOT EXISTS trigger_keyword TEXT`);
  await pool.query(`ALTER TABLE bots ADD COLUMN IF NOT EXISTS webhook_url TEXT`);
  await pool.query(`ALTER TABLE bots ADD COLUMN IF NOT EXISTS message_interval INTEGER`);
  await pool.query(`ALTER TABLE bots ADD COLUMN IF NOT EXISTS reply_delay INTEGER`);
  await pool.query(`ALTER TABLE bots ADD COLUMN IF NOT EXISTS reply_cooldown INTEGER`);
  await pool.query(`ALTER TABLE bots ADD COLUMN IF NOT EXISTS afk_interval INTEGER`);
  await pool.query(`ALTER TABLE bots ADD COLUMN IF NOT EXISTS reconnect_delay INTEGER`);
  await pool.query(`ALTER TABLE bots ADD COLUMN IF NOT EXISTS inactivity_timeout INTEGER`);
  // Custom reply actions — JSON array of command templates ({user}/{reply}).
  await pool.query(`ALTER TABLE bots ADD COLUMN IF NOT EXISTS reply_actions TEXT`);

  // Reusable reply-action presets. owner_id NULL = global (admin-managed).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_presets (
      id         TEXT PRIMARY KEY,
      owner_id   TEXT,
      name       TEXT NOT NULL,
      actions    TEXT NOT NULL,
      is_global  SMALLINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bot_presets_owner ON bot_presets(owner_id)`);
  // Optional server connection a preset can carry (nullable = preset only sets actions).
  await pool.query(`ALTER TABLE bot_presets ADD COLUMN IF NOT EXISTS server_host TEXT`);
  await pool.query(`ALTER TABLE bot_presets ADD COLUMN IF NOT EXISTS server_port INTEGER`);
  await pool.query(`ALTER TABLE bot_presets ADD COLUMN IF NOT EXISTS mc_version TEXT`);

  // Persistent anti-VPN verdict cache. Survives restarts and is shared across
  // serverless instances, so each IP only costs ONE provider lookup per TTL
  // window (keeps us well under proxycheck's 1000 req/day free limit).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vpn_cache (
      ip         TEXT PRIMARY KEY,
      vpn        SMALLINT NOT NULL DEFAULT 0,
      proxy      SMALLINT NOT NULL DEFAULT 0,
      tor        SMALLINT NOT NULL DEFAULT 0,
      hosting    SMALLINT NOT NULL DEFAULT 0,
      expires_at BIGINT NOT NULL
    )
  `);

  // Community suggestions posted in the Discord suggestions channel. Each row
  // is one suggestion card; votes are tracked per-user in suggestion_votes.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS suggestions (
      id          TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL,
      message_id  TEXT,
      thread_id   TEXT,
      author_id   TEXT NOT NULL,
      author_tag  TEXT NOT NULL,
      content     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open',
      created_at  BIGINT NOT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_suggestions_message ON suggestions(message_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS suggestion_votes (
      suggestion_id TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      vote          SMALLINT NOT NULL,
      created_at    BIGINT NOT NULL,
      PRIMARY KEY (suggestion_id, user_id),
      FOREIGN KEY (suggestion_id) REFERENCES suggestions(id) ON DELETE CASCADE
    )
  `);

  // Reviews submitted via /review — shown on the web reviews page and posted to Discord.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      discord_id    TEXT NOT NULL,
      discord_tag   TEXT NOT NULL,
      stars         INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
      feedback      TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      channel_msg_id TEXT,
      created_at    BIGINT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_reviews_created ON reviews(created_at DESC)`);

  // Global chat — messages from all users across the platform.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS global_chat_messages (
      id                  TEXT PRIMARY KEY,
      user_id             TEXT NOT NULL,
      username            TEXT NOT NULL,
      avatar_url          TEXT,
      content             TEXT NOT NULL,
      reply_to_id         TEXT,
      reply_to_username   TEXT,
      source              TEXT NOT NULL DEFAULT 'web',
      discord_message_id  TEXT,
      created_at          BIGINT NOT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_global_chat_created ON global_chat_messages(created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_global_chat_user ON global_chat_messages(user_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_global_chat_reply ON global_chat_messages(reply_to_id)`);

  // Migration: add reply columns to global_chat_messages if missing from older schema
  await pool.query(`ALTER TABLE global_chat_messages ADD COLUMN IF NOT EXISTS reply_to_id TEXT`);
  await pool.query(`ALTER TABLE global_chat_messages ADD COLUMN IF NOT EXISTS reply_to_username TEXT`);

  // Migration: add source + discord_message_id to global_chat_messages
  await pool.query(`ALTER TABLE global_chat_messages ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web'`);
  await pool.query(`ALTER TABLE global_chat_messages ADD COLUMN IF NOT EXISTS discord_message_id TEXT`);

  // Migration: add user_webhooks table if not exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_webhooks (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      channel_id      TEXT NOT NULL,
      webhook_url     TEXT NOT NULL,
      webhook_token   TEXT NOT NULL,
      created_at      BIGINT NOT NULL,
      UNIQUE(user_id, channel_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_webhooks_user ON user_webhooks(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_webhooks_channel ON user_webhooks(channel_id)`);

  // Chat timeouts — users temporarily banned from global chat.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_timeouts (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      expires_at  BIGINT NOT NULL,
      created_by  TEXT NOT NULL,
      reason      TEXT,
      created_at  BIGINT NOT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_timeouts_user ON chat_timeouts(user_id, expires_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_timeouts_expires ON chat_timeouts(expires_at)`);




  // Guild Chat — per-guild Discord bridge config. Webhook and bot token are server-side only.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_chat_configs (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      guild_id        TEXT NOT NULL,
      guild_name      TEXT,
      guild_icon      TEXT,
      channel_id      TEXT NOT NULL,
      channel_name    TEXT,
      webhook_id      TEXT,
      webhook_token   TEXT,
      webhook_url     TEXT,
      created_at      BIGINT NOT NULL,
      updated_at      BIGINT NOT NULL,
      UNIQUE(user_id, guild_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_guild_chat_user ON guild_chat_configs(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_guild_chat_guild ON guild_chat_configs(guild_id)`);



  // Bot hour balances — purchased or redeemed bot hours with expiry
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_hour_balances (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      hours       DOUBLE PRECISION NOT NULL,
      hours_used  DOUBLE PRECISION NOT NULL DEFAULT 0,
      expires_at  BIGINT NOT NULL,
      source      TEXT NOT NULL DEFAULT 'purchase',
      created_at  BIGINT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bot_hour_balances_user ON bot_hour_balances(user_id)`);

  // Add discord_role_added column to trial_redemptions if not exists
  await pool.query(`ALTER TABLE trial_redemptions ADD COLUMN IF NOT EXISTS discord_role_added SMALLINT NOT NULL DEFAULT 0`);

}

// ---------------------------------------------------------------------------
// Seed the canonical plan catalog (idempotent upsert).
// ---------------------------------------------------------------------------

async function seedPlans(pool: pg.Pool): Promise<void> {
  const plans = [
    {
      id: "free_trial",
      name: "Trial (12h)",
      description: "Try skyutils for 12 hours. One-time per account and IP.",
      price_usd: 0,
      interval: "day",
      max_bots: 1,
      max_proxies: 0,
      bot_hours: 12,
      features: JSON.stringify([
        "1 concurrent bot",
        "12 bot-hours total",
        "Shared proxies",
        "Basic telemetry",
        "Community support",
        "12-hour access",
        "1 redemption per account & IP",
      ]),
      is_active: 1,
      is_hidden: 0,
      is_trial: 1,
      sort_order: 0,
    },
    {
      id: "starter",
      name: "Rookie",
      description: "Ideal for small-scale operations and getting started.",
      price_usd: 20,
      interval: "month",
      max_bots: 1,
      max_proxies: 10,
      bot_hours: 5,
      features: JSON.stringify([
        "1 concurrent bot",
        "5 bot-hours / day",
        "10 shared proxies",
        "Basic telemetry & logs",
        "Standard beaming speed",
        "Community Discord support",
        "Monthly billing",
      ]),
      is_active: 1,
      is_hidden: 0,
      is_trial: 0,
      sort_order: 1,
    },
    {
      id: "pro",
      name: "Elite",
      description: "For power users running multiple bots simultaneously.",
      price_usd: 35,
      interval: "month",
      max_bots: 5,
      max_proxies: 50,
      bot_hours: 12,
      features: JSON.stringify([
        "5 concurrent bots",
        "12 bot-hours / day",
        "50 dedicated proxies",
        "Full analytics & live console",
        "Advanced scanner & priority queue",
        "All plugins included",
        "Fast beaming speed",
        "Priority Discord support",
        "Monthly billing",
      ]),
      is_active: 1,
      is_hidden: 0,
      is_trial: 0,
      sort_order: 2,
    },
    {
      id: "enterprise",
      name: "Champion",
      description: "Maximum throughput, dedicated resources and custom setups.",
      price_usd: 55,
      interval: "month",
      max_bots: 25,
      max_proxies: -1,
      bot_hours: -1,
      features: JSON.stringify([
        "25 concurrent bots",
        "Unlimited bot-hours",
        "Unlimited premium proxies",
        "Full analytics & live console",
        "Custom behaviors & API access",
        "All plugins included",
        "Maximum beaming speed",
        "Early access to new features",
        "Dedicated 1:1 onboarding",
        "Monthly billing",
      ]),
      is_active: 1,
      is_hidden: 0,
      is_trial: 0,
      sort_order: 3,
    },
    {
      id: "admin",
      name: "Admin",
      description: "Full unrestricted access. Automatically assigned to admins.",
      price_usd: 0,
      interval: "month",
      max_bots: -1,
      max_proxies: -1,
      bot_hours: -1,
      features: JSON.stringify([
        "Unlimited bots",
        "Unlimited bot-hours",
        "Unlimited proxies",
        "All features unlocked",
        "Admin-only access",
      ]),
      is_active: 1,
      is_hidden: 1,
      is_trial: 0,
      sort_order: 99,
    },
  ];

  for (const p of plans) {
    await pool.query(
      `INSERT INTO plans
         (id, name, description, price_usd, interval, max_bots, max_proxies,
          bot_hours, features, is_active, is_hidden, is_trial, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         price_usd = EXCLUDED.price_usd,
         max_bots = EXCLUDED.max_bots,
         max_proxies = EXCLUDED.max_proxies,
         bot_hours = EXCLUDED.bot_hours,
         features = EXCLUDED.features,
         is_active = EXCLUDED.is_active,
         is_hidden = EXCLUDED.is_hidden,
         is_trial = EXCLUDED.is_trial,
         sort_order = EXCLUDED.sort_order`,
      [
        p.id, p.name, p.description, p.price_usd, p.interval, p.max_bots,
        p.max_proxies, p.bot_hours, p.features, p.is_active, p.is_hidden,
        p.is_trial, p.sort_order,
      ],
    );
  }
}

/** Lightweight health probe used by callers that want to verify connectivity. */
export async function checkDatabaseStatus(): Promise<{
  ok: boolean;
  now?: number;
  error?: string;
}> {
  try {
    const row = await queryOne<{ now: string }>("SELECT NOW()::text AS now");
    return { ok: true, now: row ? Date.parse(row.now) : undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
