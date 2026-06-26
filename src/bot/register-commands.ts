/**
 * Run once to register / update slash commands for the guild:
 *   node --env-file-if-exists=/vercel/share/.env.project -r tsx/esm src/bot/register-commands.ts
 * or:
 *   npx tsx src/bot/register-commands.ts
 */

import process from "node:process";
import { REST, Routes } from "discord.js";
import { COMMANDS } from "./commands.js";

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error(
    "Missing env vars: DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID",
  );
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

console.log(`Registering ${COMMANDS.length} commands to guild ${guildId}...`);

try {
  const data = await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: COMMANDS },
  );
  console.log(`Successfully registered ${(data as unknown[]).length} commands.`);
} catch (err) {
  console.error("Failed to register commands:", err);
  process.exit(1);
}
