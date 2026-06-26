"""Test setup_hook alone — no other code."""
import sys
try:
    import discord
except ImportError:
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "discord.py-self", "-q"], check=True)
    import discord

TOKEN = "MTE5NjU5NzU2MjIyNDk0NzI1MA.GxylbI.GuYJ_SxYagLV2z5q-0wsZZYpWx1jl_N-VRU6jE"

class TestBot(discord.Client):
    __slots__ = ()
    async def setup_hook(self):
        print("[SETUP] fired!")
        await self.close()

client = TestBot()
client.run(TOKEN)
