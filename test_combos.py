"""
Test add_relationship combos sequentially (first success stops further tests).
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

        rel = incoming[0]
        uid = rel.get("user", {}).get("id")
        uname = rel.get("user", {}).get("username", "?")
        print(f"[TEST] Testing accept methods for: {uname} ({uid})\n")

        from discord.http import RelationshipAction

        tests = [
            {"action": RelationshipAction.accept_request},
            {"type": 1, "action": RelationshipAction.accept_request},
            {"type": 4, "action": RelationshipAction.accept_request},
            {"action": RelationshipAction.send_friend_request},
            {"type": 1, "action": RelationshipAction.send_friend_request},
        ]

        for combo in tests:
            print(f"[TEST] Trying: {combo}")
            try:
                await self.http.add_relationship(str(uid), **combo)
                print(f"[TEST] ✓ SUCCESS: {combo}")
                await asyncio.sleep(1)
                await self.close()
                return
            except discord.HTTPException as e:
                code = getattr(e, "code", None)
                print(f"[TEST] ✗ code={code}: {str(e.text)[:100]}")
                if code == 80013:
                    continue  # try next combo
                else:
                    print(f"[TEST] Non-80013 error, stopping")
                    break
            except Exception as e:
                print(f"[TEST] ✗ {type(e).__name__}: {e}")
                break

        await asyncio.sleep(1)
        await self.close()


client = TestBot()
client.run(TOKEN)
