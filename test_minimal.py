"""
Minimal test: does on_ready fire at all?
Usage: .venv/bin/python3 test_minimal.py
"""
import sys
try:
    import discord
except ImportError:
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "discord.py-self", "-q"], check=True)
    import discord

TOKEN = "MTE5NjU5NzU2MjIyNDk0NzI1MA.GxylbI.GuYJ_SxYagLV2z5q-0wsZZYpWx1jl_N-VRU6jE"

client = discord.Client()


@client.event
async def on_ready():
    print(f"[READY] fired! user={client.user}")
    await client.close()  # properly await the coroutine


client.run(TOKEN)
