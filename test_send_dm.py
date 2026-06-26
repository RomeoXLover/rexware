"""
Quick DM send test with the temp token.
Usage: .venv/bin/python3 test_send_dm.py [user_id] [message]
"""
import asyncio
import sys

try:
    import discord
except ImportError:
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "discord.py-self", "-q"], check=True)
    import discord

TOKEN = "MTQ4NjI5NjQ0MjY0NDcyOTkwNg.GIULwQ.7JupowzmZzoYoBh_bIeE-CJ1QYNK1MmFDMS-_M"
DEFAULT_MSG = "hello! this is a test message from the bot runner :)"
BASE = "https://discord.com/api/v10"


class TestBot(discord.Client):
    def __init__(self, target_id, message):
        super().__init__()
        self.target_id = target_id
        self.message = message

    async def setup_hook(self):
        asyncio.create_task(self._send_dm())

    async def _send_dm(self):
        await self.wait_until_ready()
        print(f"[READY] Logged in as {self.user}", flush=True)
        if not self.target_id:
            print("[READY] No target user ID provided — listing recent DMs instead", flush=True)
            await self._list_recent_dms()
            await self.close()
            return

        print(f"[READY] Fetching user {self.target_id}...", flush=True)
        try:
            user = await self.fetch_user(int(self.target_id))
            print(f"[READY] Found user: {user.name} ({user.id})", flush=True)
        except Exception as e:
            print(f"[ERROR] Could not fetch user: {e}", flush=True)
            await self.close()
            return

        print(f"[READY] Opening DM channel with {user.name}...", flush=True)
        try:
            dm = user.dm_channel or await user.create_dm()
            print(f"[READY] DM channel: {dm.id}", flush=True)
        except Exception as e:
            print(f"[ERROR] Could not create/open DM: {e}", flush=True)
            await self.close()
            return

        print(f"[READY] Sending message: {self.message!r}", flush=True)
        await asyncio.sleep(2)  # Brief delay for safety
        try:
            sent = await dm.send(self.message)
            print(f"[READY] Message sent! ID: {sent.id}", flush=True)
        except Exception as e:
            print(f"[ERROR] Failed to send: {e}", flush=True)

        await self.close()

    async def _list_recent_dms(self):
        """List all recent DM channels via REST."""
        try:
            rels = await self.http.get_relationships()
            print(f"[DM LIST] Total relationships: {len(rels)}", flush=True)
            for rel in rels:
                rtype = rel.get("type")
                uid = rel.get("user", {}).get("id")
                uname = rel.get("user", {}).get("username", str(uid))
                if rtype == 1:  # friend
                    print(f"  [FRIEND] {uname} ({uid})", flush=True)
                elif rtype == 3:
                    print(f"  [INCOMING_REQ] {uname} ({uid})", flush=True)
                elif rtype == 4:
                    print(f"  [OUTGOING_REQ] {uname} ({uid})", flush=True)
        except Exception as e:
            print(f"[ERROR] Could not list relationships: {e}", flush=True)


def main():
    target_id = sys.argv[1] if len(sys.argv) > 1 else None
    message = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_MSG
    print(f"[INFO] Target: {target_id}, Message: {message!r}", flush=True)
    client = TestBot(target_id, message)
    client.run(TOKEN)


if __name__ == "__main__":
    main()
