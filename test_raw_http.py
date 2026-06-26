"""
Test raw HTTP approach for accepting friend requests.
Uses discord.py's internal requests.AsyncSession directly.
"""
import asyncio
import sys

try:
    import discord
    from discord.enums import RelationshipType
except ImportError:
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "discord.py-self", "-q"], check=True)
    import discord
    from discord.enums import RelationshipType

TOKEN = "MTE5NjU5NzU2MjIyNDk0NzI1MA.GxylbI.GuYJ_SxYagLV2z5q-0wsZZYpWx1jl_N-VRU6jE"

BASE = "https://discord.com/api/v10"


class TestBot(discord.Client):
    async def setup_hook(self):
        self.loop.create_task(self._test())

    async def _test(self):
        await self.wait_until_ready()

        rels = await self.http.get_relationships()
        incoming = [r for r in rels if r.get("type") == RelationshipType.incoming_request.value]
        if not incoming:
            print("[TEST] No incoming requests found")
            await self.close()
            return

        uid = incoming[0].get("user", {}).get("id")
        uname = incoming[0].get("user", {}).get("username", "?")
        print(f"[TEST] Testing accept methods for: {uname} ({uid})")

        # Access the requests.AsyncSession
        http_session = self.http._HTTPClient__session
        print(f"[TEST] Session type: {type(http_session)}")

        url = f"{BASE}/users/@me/relationships/{uid}"

        tests = [
            ("PUT", {"type": 1}),
            ("PUT", {"type": 3}),
            ("POST", {"type": 1}),
        ]

        headers = {"Authorization": TOKEN, "Content-Type": "application/json"}

        for method, payload in tests:
            print(f"\n[TEST] {method} {url} json={payload}")
            try:
                resp = await http_session.request(method, url, json=payload, headers=headers)
                print(f"[TEST] status={resp.status_code} body={resp.text[:200]}")
                if resp.status_code in (200, 201, 204):
                    print(f"[TEST] ✓ SUCCESS")
                    break
            except Exception as e:
                print(f"[TEST] ✗ {type(e).__name__}: {e}")

        await asyncio.sleep(1)
        await self.close()


client = TestBot()
client.run(TOKEN)
