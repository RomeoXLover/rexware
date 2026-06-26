"""
Test Relationship.accept() on objects from get_relationships().
Usage: .venv/bin/python3 test_rel_accept.py
"""
import asyncio
import sys

try:
    import discord
    from discord.enums import RelationshipType
    from discord.relationship import Relationship
except ImportError:
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "discord.py-self", "-q"], check=True)
    import discord
    from discord.enums import RelationshipType
    from discord.relationship import Relationship

TOKEN = "MTE5NjU5NzU2MjIyNDk0NzI1MA.GxylbI.GuYJ_SxYagLV2z5q-0wsZZYpWx1jl_N-VRU6jE"


class TestBot(discord.Client):
    async def setup_hook(self):
        print("[SETUP] checking relationships...")
        self.loop.create_task(self._check_and_accept())

    async def _check_and_accept(self):
        await self.wait_until_ready()
        print("[CHECK] relationships:")
        try:
            rels = await self.http.get_relationships()
        except Exception as e:
            print(f"[CHECK] get_relationships failed: {e}")
            await self.close()
            return

        incoming = []
        for rel in rels:
            t = rel.get("type", 0)
            uname = rel.get("user", {}).get("username", "?")
            uid = rel.get("user", {}).get("id", "?")
            print(f"  type={t} ({RelationshipType.incoming_request.value if t == 3 else '---'}) user={uname} ({uid})")

            if t == RelationshipType.incoming_request.value:
                incoming.append((rel, uname, uid))

        print(f"\n[CHECK] Found {len(incoming)} incoming requests")

        for rel, uname, uid in incoming:
            print(f"\n[ACCEPT] Trying Relationship.accept() on {uname}...")
            try:
                # Build a Relationship object manually
                # The Relationship needs a ConnectionState to access http
                state = self._connection
                rel_obj = Relationship(state=state, data={
                    'id': str(uid),
                    'type': rel['type'],
                    'user': rel['user'],
                })
                await rel_obj.accept()
                print(f"[ACCEPT] ✓ Relationship.accept() succeeded for {uname}")
            except Exception as e:
                print(f"[ACCEPT] ✗ Relationship.accept() failed: {e}")

        await asyncio.sleep(3)
        await self.close()


client = TestBot()
client.run(TOKEN)
