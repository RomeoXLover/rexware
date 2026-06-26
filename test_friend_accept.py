"""
Comprehensive friend-request + relationship handler — ALL types.
discord.py-self 2.1.0 user-account API.

Handles every relationship state:
  - Incoming friend requests (type 3)  → accept them
  - Outgoing friend requests (type 4)  → confirm them (send mutual back)
  - Already-friend (type 1)            → do nothing (already friends)
  - Blocked / suggestions               → skip

Usage:
  .venv/bin/python3 test_friend_accept.py          # watch all relationships
  .venv/bin/python3 test_friend_accept.py --target USER_ID  # proactively add a friend
"""
import argparse
import asyncio
import random
import sys

try:
    import discord
    from discord.enums import RelationshipType
except ImportError:
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "discord.py-self", "-q"], check=True)
    import discord
    from discord.enums import RelationshipType

TOKEN = "MTQ4NjI5NjQ0MjY0NDcyOTkwNg.GIULwQ.7JupowzmZzoYoBh_bIeE-CJ1QYNK1MmFDMS-_M"
BASE = "https://discord.com/api/v10"
POLL_INTERVAL = 5

# RelationshipType enum values
# 0 = none, 1 = friend, 2 = blocked, 3 = incoming_request
# 4 = outgoing_request, 5 = implicit, 6 = suggestion
RT_INCOMING = RelationshipType.incoming_request.value   # 3
RT_OUTGOING = RelationshipType.outgoing_request.value   # 4
RT_FRIEND   = RelationshipType.friend.value             # 1
RT_BLOCKED  = RelationshipType.blocked.value            # 2


def humanized(nominal: float, floor: float = 0.0) -> float:
    return round(max(floor, nominal) + random.uniform(0, max(floor, nominal) * 0.4), 2)


def get_session(client: discord.Client):
    return client.http._HTTPClient__session


class RelationshipBot(discord.Client):
    """Handles ALL relationship types."""

    __slots__ = ('_handled', '_target_uid')

    def __init__(self, target_uid: str | None = None, **kwargs):
        super().__init__(**kwargs)
        self._handled: set = set()      # uid -> True once we've processed this request
        self._target_uid = target_uid  # for --target mode

    async def setup_hook(self) -> None:
        asyncio.create_task(self._wait_and_run())
        if self._target_uid:
            asyncio.create_task(self._send_friend_request())

    async def _wait_and_run(self):
        await self.wait_until_ready()
        print(f"[READY] Logged in as {self.user}", flush=True)
        # Drain ALL already-pending requests BEFORE starting the loop
        await self._drain_pending()
        await self._relationship_loop()

    # ── Drain: immediately accept all already-pending requests on startup ─────────
    async def _drain_pending(self):
        """Called once at startup: scan ALL existing relationships and accept/confirm
        any that are already pending (incoming or outgoing). This ensures requests
        that arrived while the bot was offline are processed immediately."""
        print("[DRAIN] Scanning existing relationships...", flush=True)
        try:
            rels = await self.http.get_relationships()
        except Exception as e:
            print(f"[DRAIN] get_relationships failed: {e}", flush=True)
            return

        pending = []
        for rel in rels:
            rtype  = rel.get("type")
            uid    = str(rel.get("user", {}).get("id", ""))
            uname  = rel.get("user", {}).get("username", uid)
            label  = TYPE_LABELS.get(rtype, f"type-{rtype}")

            if rtype == RT_INCOMING:
                pending.append(("incoming", uid, uname))
            elif rtype == RT_OUTGOING:
                pending.append(("outgoing", uid, uname))
            elif rtype == RT_FRIEND:
                print(f"[DRAIN] [{label}] {uname} ({uid}) — already friends, skipping", flush=True)
            elif rtype == RT_BLOCKED:
                print(f"[DRAIN] [{label}] {uname} ({uid}) — blocked, skipping", flush=True)
            elif rtype in (5, 6):
                print(f"[DRAIN] [{label}] {uname} ({uid}) — skipping", flush=True)

        if not pending:
            print("[DRAIN] No pending requests found.", flush=True)
            return

        print(f"[DRAIN] Found {len(pending)} pending request(s):", flush=True)
        for kind, uid, uname in pending:
            print(f"  [{kind.upper()}] {uname} ({uid})", flush=True)

        # Process each with a stagger so it doesn't look bot-like
        for i, (kind, uid, uname) in enumerate(pending):
            if kind == "incoming":
                print(f"[DRAIN] Accepting incoming from {uname}...", flush=True)
                await self._accept_incoming(uid, uname)
            else:
                print(f"[DRAIN] Confirming mutual with outgoing to {uname}...", flush=True)
                await self._confirm_outgoing(uid, uname)

            # Humanised stagger between each action (don't hit all at once)
            if i < len(pending) - 1:
                stagger = humanized(6, floor=3.0)
                print(f"[DRAIN] Staggering {stagger:.1f}s before next...", flush=True)
                await asyncio.sleep(stagger)

        print("[DRAIN] Done draining pending requests.", flush=True)

    # ── Proactively send a friend request ─────────────────────────────────────
    async def _send_friend_request(self):
        uid = self._target_uid
        if not uid:
            return
        await self.wait_until_ready()
        delay = humanized(5, floor=2.0)
        print(f"[SEND] Waiting {delay:.1f}s before sending friend request to {uid}...", flush=True)
        await asyncio.sleep(delay)

        session = get_session(self)
        headers = {"Authorization": self.http.token, "Content-Type": "application/json"}
        url = f"{BASE}/users/@me/relationships/{uid}"

        # Try all methods
        for method, payload, desc in ALL_METHODS:
            try:
                resp = await session.request(method, url, json=payload, headers=headers)
                body = resp.text[:200]
                print(f"[SEND] {method} {url} {payload} -> {resp.status_code}: {body}", flush=True)
                if resp.status_code in (200, 201, 204):
                    print(f"[SEND] ✓ SUCCESS via {method} {payload}", flush=True)
                    return
            except Exception as e:
                print(f"[SEND] {method} ✗ {type(e).__name__}: {e}", flush=True)

    # ── Main relationship poller ──────────────────────────────────────────────────
    async def _relationship_loop(self):
        print(f"[LOOP] Relationship handler running (every {POLL_INTERVAL}s)...", flush=True)
        while not self.is_closed():
            await asyncio.sleep(POLL_INTERVAL)
            try:
                rels = await self.http.get_relationships()
            except Exception as e:
                print(f"[LOOP] get_relationships failed: {e}", flush=True)
                continue

            for rel in rels:
                rtype  = rel.get("type")
                uid    = str(rel.get("user", {}).get("id", ""))
                uname  = rel.get("user", {}).get("username", uid)
                action = TYPE_LABELS.get(rtype, f"type-{rtype}")

                if rtype == RT_BLOCKED:
                    continue  # never touch blocked users
                if rtype == RT_FRIEND:
                    continue  # already friends, nothing to do
                if rtype == 5 or rtype == 6:  # implicit / suggestion
                    continue

                if uid in self._handled:
                    continue

                print(f"[LOOP] [{action}] {uname} ({uid})", flush=True)

                if rtype == RT_INCOMING:
                    # Someone sent us a friend request → accept it
                    await self._accept_incoming(uid, uname)
                elif rtype == RT_OUTGOING:
                    # We sent a request → confirm it (mutual) so BOTH sides are friends
                    await self._confirm_outgoing(uid, uname)
                else:
                    print(f"[LOOP] Unknown type {rtype} for {uname} — skipping", flush=True)

                self._handled.add(uid)

            if len(self._handled) > 500:
                self._handled.clear()

    # ── Accept an INCOMING friend request (type 3 → type 1) ───────────────────
    async def _accept_incoming(self, uid: str, uname: str):
        session = get_session(self)
        headers = {"Authorization": self.http.token, "Content-Type": "application/json"}
        url = f"{BASE}/users/@me/relationships/{uid}"
        delay = humanized(5, floor=2.0)
        if delay > 0:
            print(f"[ACCEPT:{uname}] Waiting {delay:.1f}s...", flush=True)
            await asyncio.sleep(delay)

        # Method 1: Relationship.accept() from in-memory cache
        print(f"[ACCEPT:{uname}] Trying Relationship.accept()...", flush=True)
        for rel in self.relationships:
            try:
                rel_id = str(getattr(getattr(rel, "user", None), "id", "") or getattr(rel, "id", ""))
                if rel_id == uid:
                    await rel.accept()
                    print(f"[ACCEPT:{uname}] ✓ Relationship.accept() succeeded!", flush=True)
                    return
            except Exception:
                pass

        # Methods 2-7: Raw HTTP
        for method, payload, desc in ALL_METHODS:
            print(f"[ACCEPT:{uname}] Trying HTTP {method} {payload}...", flush=True)
            try:
                resp = await session.request(method, url, json=payload, headers=headers)
                body = resp.text[:200]
                if resp.status_code in (200, 201, 204):
                    print(f"[ACCEPT:{uname}] ✓ HTTP {method} {payload} -> {resp.status_code}", flush=True)
                    return
                else:
                    print(f"[ACCEPT:{uname}] HTTP {method} {payload} -> {resp.status_code}: {body}", flush=True)
            except Exception as e:
                print(f"[ACCEPT:{uname}] HTTP {method} ✗ {type(e).__name__}: {e}", flush=True)

        # Method 8: http.add_relationship
        print(f"[ACCEPT:{uname}] Trying http.add_relationship()...", flush=True)
        try:
            await self.http.add_relationship(uid, 1)
            print(f"[ACCEPT:{uname}] ✓ http.add_relationship() succeeded!", flush=True)
            return
        except Exception as e:
            print(f"[ACCEPT:{uname}] add_relationship() failed: {e}", flush=True)

        # Method 9: http.edit_relationship
        print(f"[ACCEPT:{uname}] Trying http.edit_relationship()...", flush=True)
        try:
            await self.http.edit_relationship(uid, 1)
            print(f"[ACCEPT:{uname}] ✓ http.edit_relationship() succeeded!", flush=True)
            return
        except Exception as e:
            print(f"[ACCEPT:{uname}] edit_relationship() failed: {e}", flush=True)

        print(f"[ACCEPT:{uname}] ✗ All methods failed", flush=True)

    # ── Confirm an OUTGOING request (mutual) ─────────────────────────────────────
    # When WE sent a request (type 4), sending a reverse (type 3) + accepting
    # makes both sides friends. We try all accept methods on the outgoing request.
    async def _confirm_outgoing(self, uid: str, uname: str):
        session = get_session(self)
        headers = {"Authorization": self.http.token, "Content-Type": "application/json"}
        url = f"{BASE}/users/@me/relationships/{uid}"
        delay = humanized(5, floor=2.0)
        if delay > 0:
            print(f"[CONFIRM:{uname}] Waiting {delay:.1f}s...", flush=True)
            await asyncio.sleep(delay)

        # Method 1: Relationship.accept() from in-memory cache
        print(f"[CONFIRM:{uname}] Trying Relationship.accept()...", flush=True)
        for rel in self.relationships:
            try:
                rel_id = str(getattr(getattr(rel, "user", None), "id", "") or getattr(rel, "id", ""))
                if rel_id == uid:
                    await rel.accept()
                    print(f"[CONFIRM:{uname}] ✓ Relationship.accept() succeeded! (mutual)", flush=True)
                    return
            except Exception:
                pass

        # Method 2: send_friend_request — this is the KEY for outgoing:
        # Sending a friend request back to someone who already sent you one
        # results in BOTH becoming mutual friends.
        print(f"[CONFIRM:{uname}] Trying send_friend_request() (mutual back)...", flush=True)
        try:
            await self.send_friend_request(uid)
            print(f"[CONFIRM:{uname}] ✓ send_friend_request() succeeded! (mutual)", flush=True)
            return
        except Exception as e:
            print(f"[CONFIRM:{uname}] send_friend_request() failed: {e}", flush=True)

        # Methods 3-8: Raw HTTP — try all types on the existing relationship
        for method, payload, desc in ALL_METHODS:
            print(f"[CONFIRM:{uname}] Trying HTTP {method} {payload}...", flush=True)
            try:
                resp = await session.request(method, url, json=payload, headers=headers)
                body = resp.text[:200]
                if resp.status_code in (200, 201, 204):
                    print(f"[CONFIRM:{uname}] ✓ HTTP {method} {payload} -> {resp.status_code}", flush=True)
                    return
                else:
                    print(f"[CONFIRM:{uname}] HTTP {method} {payload} -> {resp.status_code}: {body}", flush=True)
            except Exception as e:
                print(f"[CONFIRM:{uname}] HTTP {method} ✗ {type(e).__name__}: {e}", flush=True)

        # Method 9: http.add_relationship
        print(f"[CONFIRM:{uname}] Trying http.add_relationship()...", flush=True)
        try:
            await self.http.add_relationship(uid, 1)
            print(f"[CONFIRM:{uname}] ✓ http.add_relationship() succeeded!", flush=True)
            return
        except Exception as e:
            print(f"[CONFIRM:{uname}] add_relationship() failed: {e}", flush=True)

        print(f"[CONFIRM:{uname}] ✗ All methods failed", flush=True)


# ── All HTTP accept/confirm methods ─────────────────────────────────────────────
# Every combination of method + payload that might work for any relationship type.
ALL_METHODS = [
    ("PUT",   {"type": 1}, "PUT type=1 (friend)"),
    ("POST",  {"type": 1}, "POST type=1"),
    ("PUT",   {"type": 3}, "PUT type=3 (incoming request)"),
    ("POST",  {"type": 3}, "POST type=3"),
    ("PATCH", {"type": 1}, "PATCH type=1"),
    ("PATCH", {"type": 3}, "PATCH type=3"),
    ("DELETE", {"type": 1}, "DELETE type=1 (remove?)"),
]

TYPE_LABELS = {
    RT_INCOMING: "INCOMING_REQUEST",
    RT_OUTGOING:  "OUTGOING_REQUEST",
    RT_FRIEND:    "FRIEND",
    RT_BLOCKED:   "BLOCKED",
    5:            "IMPLICIT",
    6:            "SUGGESTION",
}


def main():
    parser = argparse.ArgumentParser(description="Discord relationship handler (discord.py-self 2.1.0)")
    parser.add_argument("--target", help="Proactively send a friend request to this user ID")
    args = parser.parse_args()

    print("[INFO] Starting...", flush=True)
    client = RelationshipBot(target_uid=args.target)
    client.run(TOKEN)


if __name__ == "__main__":
    main()
