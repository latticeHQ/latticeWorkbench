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

Reference: https://github.com/livekit-examples/python-agents-examples/tree/main/complex-agents/avatars/anam
"""

import json
import logging
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

    await session.start(
        agent=LatticeAssistant(ctx),
        room=ctx.room,
    )

    # Greet the user
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
