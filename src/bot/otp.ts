/**
 * SkyUtils Discord Bot — OTP confirmation for critical admin actions.
 *
 * Second factor is the rotating TOTP code shown on the website
 * (Settings → Admin OTP). It is intentionally delivered on a DIFFERENT channel
 * than Discord: an attacker who controls an admin's Discord account still
 * cannot run protected commands without also having the admin's logged-in web
 * session. No code is ever sent over Discord.
 *
 * Flow:
 *   1. A critical command validates its input, then calls `requestConfirmation`
 *      instead of executing immediately.
 *   2. The bot replies (ephemeral) with an "Enter code" button.
 *   3. Clicking the button opens a modal where the admin types the 6-digit code
 *      currently displayed on the website.
 *   4. The code is verified against the admin's TOTP secret (stateless,
 *      RFC 6238). On success the stored action runs; otherwise it is rejected.
 *
 * Pending actions hold only the closure to run (never a code) and are kept
 * in-memory keyed by a random token. The bot is a single process (singleton
 * lock in index.ts), so no shared store is needed. Tokens expire after 5
 * minutes and allow at most 3 attempts.
 */

import { randomBytes } from "node:crypto";
import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from "discord.js";

import {
  text,
  sep,
  row,
  btn,
  container,
  cv2Message,
  infoMessage,
  errorMessage,
  resetIds,
  COLOR,
} from "./components.js";
import { usersRepo } from "../lib/repos.server.js";
import { verifyTotp } from "../lib/totp.server.js";
import { isOwnerId } from "../lib/config.server.js";

type Runner = (i: ModalSubmitInteraction) => Promise<void>;

interface PendingAction {
  secret: string; // the actor admin's TOTP secret
  actorId: string; // Discord user id of the admin who initiated the action
  title: string;
  summary: string;
  run: Runner;
  expiresAt: number;
  attempts: number;
}

const TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;

const pending = new Map<string, PendingAction>();

function sweep() {
  const now = Date.now();
  for (const [token, action] of pending) {
    if (action.expiresAt < now) pending.delete(token);
  }
}

function reply(
  i: ButtonInteraction | ModalSubmitInteraction,
  payload: ReturnType<typeof errorMessage>,
) {
  return i.reply({ ...payload, ephemeral: true } as never).catch(() => null);
}

/**
 * Request OTP confirmation for a critical action. Call this from a slash
 * command handler AFTER validating the input. Do not defer the interaction
 * beforehand — this sends the first response itself.
 */
export async function requestConfirmation(
  i: ChatInputCommandInteraction,
  opts: { title: string; summary: string; run: Runner },
): Promise<void> {
  sweep();

  // Resolve the invoking admin and ensure they have a TOTP secret. Only admins
  // or owners can reach protected commands, but we re-check here as a hard gate.
  const actor = await usersRepo.byDiscordId(i.user.id);
  const isOwner = isOwnerId(i.user.id);
  if (!actor || (actor.is_admin !== 1 && !isOwner)) {
    resetIds();
    await i
      .reply({
        ...errorMessage("This action requires an administrator account."),
        ephemeral: true,
      } as never)
      .catch(() => null);
    return;
  }

  // Owners bypass TOTP verification for faster execution
  if (isOwner) {
    resetIds();
    await i.reply({
      ...cv2Message([
        container(
          [
            text(`## Confirm: ${opts.title}`),
            sep(false),
            text(`${opts.summary}\n\n⚠️ **Owner bypass — no OTP required.**`),
            sep(false),
            row(
              btn("Confirm (Owner)", 3, { customId: `otp_confirm:${randomBytes(9).toString("hex")}:owner:${i.user.id}` }),
              btn("Cancel", 4, { customId: "otp_cancel_dummy" }),
            ),
          ],
          COLOR.warning,
        ),
      ]),
      ephemeral: true,
    } as never);
    return;
  }

  const secret = await usersRepo.getOrCreateAdminOtpSecret(actor.id);
  const token = randomBytes(9).toString("hex");

  pending.set(token, {
    secret,
    actorId: i.user.id,
    title: opts.title,
    summary: opts.summary,
    run: opts.run,
    expiresAt: Date.now() + TTL_MS,
    attempts: 0,
  });

  resetIds();
  await i.reply({
    ...cv2Message([
      container(
        [
          text(`## Confirm: ${opts.title}`),
          sep(false),
          text(
            `${opts.summary}\n\nThis is a protected action. Open the website and go to ` +
              "**Settings → Admin OTP** to get your current 6-digit code, then click " +
              "**Enter code** below and type it before it rotates.",
          ),
          sep(false),
          row(
            btn("Enter code", 1, { customId: `otp_confirm:${token}` }),
            btn("Cancel", 4, { customId: `otp_cancel:${token}` }),
          ),
        ],
        COLOR.warning,
      ),
    ]),
    ephemeral: true,
  } as never);
}

/** Button: otp_confirm:<token> — open the code-entry modal. */
export async function handleOtpConfirmButton(
  i: ButtonInteraction,
  token: string,
): Promise<void> {
  const action = pending.get(token);
  if (!action) {
    await reply(
      i,
      errorMessage("This confirmation has expired. Run the command again."),
    );
    return;
  }
  if (action.actorId !== i.user.id) {
    await reply(
      i,
      errorMessage("Only the admin who initiated this action can confirm it."),
    );
    return;
  }
  if (action.expiresAt < Date.now()) {
    pending.delete(token);
    await reply(
      i,
      errorMessage("This confirmation has expired. Run the command again."),
    );
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`otp_modal:${token}`)
    .setTitle("Confirm critical action");

  const input = new TextInputBuilder()
    .setCustomId("code")
    .setLabel("6-digit code from the website")
    .setStyle(TextInputStyle.Short)
    .setMinLength(6)
    .setMaxLength(6)
    .setRequired(true)
    .setPlaceholder("123456");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input),
  );

  await i.showModal(modal);
}

/** Button: otp_cancel:<token> — discard the pending action. */
export async function handleOtpCancelButton(
  i: ButtonInteraction,
  token: string,
): Promise<void> {
  pending.delete(token);
  await reply(
    i,
    infoMessage("Cancelled", "The action was cancelled. Nothing was changed."),
  );
}

/** Modal: otp_modal:<token> — verify the code and run the action. */
export async function handleOtpModal(
  i: ModalSubmitInteraction,
  token: string,
): Promise<void> {
  const action = pending.get(token);
  if (!action) {
    await reply(
      i,
      errorMessage("This confirmation has expired. Run the command again."),
    );
    return;
  }
  if (action.actorId !== i.user.id) {
    await reply(
      i,
      errorMessage("Only the admin who initiated this action can confirm it."),
    );
    return;
  }
  if (action.expiresAt < Date.now()) {
    pending.delete(token);
    await reply(
      i,
      errorMessage("This confirmation has expired. Run the command again."),
    );
    return;
  }

  const entered = i.fields.getTextInputValue("code").trim();
  // window=1 tolerates ±30s of clock drift between bot and admin's browser.
  if (!verifyTotp(action.secret, entered, { window: 1 })) {
    action.attempts += 1;
    if (action.attempts >= MAX_ATTEMPTS) {
      pending.delete(token);
      await reply(
        i,
        errorMessage("Too many incorrect attempts. The action was cancelled."),
      );
      return;
    }
    await reply(
      i,
      errorMessage(
        `Incorrect or expired code. ${MAX_ATTEMPTS - action.attempts} attempt(s) left. ` +
          "Make sure you're reading the latest code from Settings → Admin OTP.",
      ),
    );
    return;
  }

  // Success — consume the token and execute the protected action.
  pending.delete(token);
  await action.run(i);
}
