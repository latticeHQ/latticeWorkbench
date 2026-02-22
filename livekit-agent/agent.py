"""
latticeWorkbench LiveKit Agent
================================
A voice + video AI agent that joins a LiveKit room and responds to the user
using speech-to-text → LLM → text-to-speech.

Usage:
  pip install -r requirements.txt
  cp .env.example .env          # fill in your keys
  python agent.py dev           # local dev mode (connects to your LIVEKIT_URL room)
  python agent.py start         # production mode

The workbench browser client connects to the same LiveKit room — credentials
are configured in the workbench Settings → Providers → LiveKit.

── Avatar Video (optional) ──────────────────────────────────────────────────
To render a talking-head avatar video visible in the workbench:
  1. pip install livekit-agents[anam]  (or uncomment it in requirements.txt)
  2. Add ANAM_API_KEY=... to your .env
The agent will automatically detect the key and enable the Anam avatar.
Without ANAM_API_KEY the agent runs in voice-only mode.

Reference: https://github.com/livekit-examples/python-agents-examples/tree/main/complex-agents/avatars/anam
"""

import json
import logging
import os
from typing import Any

from dotenv import load_dotenv

from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    RunContext,
    cli,
    function_tool,
)
from livekit.plugins import deepgram, openai, silero

load_dotenv()
logger = logging.getLogger(__name__)

# ── Anam avatar (optional) ─────────────────────────────────────────────────────
# Import the plugin only if installed + API key is present.

_ANAM_API_KEY = os.getenv("ANAM_API_KEY")
_ANAM_PERSONA_ID = os.getenv("ANAM_PERSONA_ID")  # optional — uses default persona if unset

try:
    if _ANAM_API_KEY:
        from livekit.plugins import anam as _anam_plugin  # type: ignore[import]
        logger.info("Anam avatar plugin loaded — avatar video will be published")
    else:
        _anam_plugin = None  # type: ignore[assignment]
        logger.info("ANAM_API_KEY not set — running in voice-only mode (no avatar video)")
except ImportError:
    _anam_plugin = None  # type: ignore[assignment]
    logger.warning(
        "livekit-agents[anam] not installed — running in voice-only mode. "
        "Install with: pip install 'livekit-agents[anam]~=1.3'"
    )

# ── Server setup ──────────────────────────────────────────────────────────────

server = AgentServer()


def prewarm(proc: JobProcess) -> None:
    """Preload the VAD model into process memory so the first call is fast."""
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


# ── Agent definition ──────────────────────────────────────────────────────────

class LatticeAssistant(Agent):
    """The AI brain that runs in the LiveKit room.

    Receives audio from the user, processes it with an LLM, and speaks back.
    Can also call RPC methods on the workbench frontend to inject chat messages.
    """

    def __init__(self, ctx: JobContext) -> None:
        self._ctx = ctx
        super().__init__(
            instructions=(
                "You are a helpful AI assistant connected via a real-time voice session. "
                "Keep responses concise and conversational. "
                "When you want to send a text message to the workbench chat, "
                "call the send_chat_message tool."
            )
        )

    @function_tool
    async def send_chat_message(self, context: RunContext, message: str) -> str:
        """Send a text message to the workbench PM Chat pane via LiveKit RPC."""
        payload = json.dumps({"text": message})
        try:
            remote_identity = _get_remote_identity(self._ctx)
            if not remote_identity:
                return "no remote participant"
            response = await self._ctx.room.local_participant.perform_rpc(
                destination_identity=remote_identity,
                method="sendMessage",
                payload=payload,
                response_timeout=5.0,
            )
            logger.info("RPC sendMessage response: %s", response)
            return "sent"
        except Exception as exc:  # noqa: BLE001
            logger.warning("RPC sendMessage failed: %s", exc)
            return f"error: {exc}"


# ── Session handler ───────────────────────────────────────────────────────────

@server.rtc_session(agent_name="LatticeAgent")
async def session_handler(ctx: JobContext) -> None:
    """Called for every new participant that joins the LiveKit room."""
    await ctx.connect()
    logger.info("Connected to room: %s", ctx.room.name)

    session = AgentSession(
        # Speech-to-Text
        stt=deepgram.STT(model="nova-3"),
        # Language Model
        llm=openai.LLM(model="gpt-4o-mini"),
        # Text-to-Speech
        tts=openai.TTS(voice="alloy"),
        # Voice Activity Detection
        vad=ctx.proc.userdata["vad"],
    )

    if _anam_plugin is not None and _ANAM_API_KEY:
        # ── Avatar mode: Anam talking-head video ──────────────────────────
        # AvatarRunner streams the TTS audio to Anam's cloud API and receives
        # back a real-time video stream of a talking face, which is published
        # to the LiveKit room — the workbench will render it in LiveKitVideoTile.
        anam_kwargs: dict[str, Any] = {"api_key": _ANAM_API_KEY}
        if _ANAM_PERSONA_ID:
            anam_kwargs["persona_id"] = _ANAM_PERSONA_ID

        avatar = _anam_plugin.AvatarRunner(
            _anam_plugin.AnamAvatarSession(**anam_kwargs)
        )
        async with avatar.session(ctx.room) as av:
            await session.start(
                agent=LatticeAssistant(ctx),
                room=ctx.room,
                video_track=av.video_track,
            )
            await session.say("Hello! I'm your AI assistant with avatar video. How can I help you today?")
            # Keep running until room disconnects
            await ctx.wait_until_disconnected()
    else:
        # ── Voice-only mode ───────────────────────────────────────────────
        await session.start(
            agent=LatticeAssistant(ctx),
            room=ctx.room,
        )
        await session.say("Hello! I'm your AI assistant. How can I help you today?")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_remote_identity(ctx: JobContext) -> str | None:
    """Return the identity of the first non-agent remote participant."""
    for identity in ctx.room.remote_participants:
        return identity
    return None


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    cli.run_app(server)
