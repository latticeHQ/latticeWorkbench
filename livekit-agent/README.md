# Lattice LiveKit Agent

A voice + video AI agent for the latticeWorkbench PM Chat.

## Quick Start

```bash
# 1. Install dependencies (Python 3.11+)
pip install -r requirements.txt

# 2. Copy and fill in your credentials
cp .env.example .env

# 3. Run in dev mode (connects to your LiveKit room)
python agent.py dev
```

The agent will:
- Join the LiveKit room matching the workspace ID you opened in the workbench
- Listen to your voice via Deepgram STT
- Respond using GPT-4o-mini
- Speak back using OpenAI TTS
- Send messages to the workbench chat via LiveKit RPC

## Workbench Configuration

In the workbench: **Settings → Providers → LiveKit**

| Field | Value |
|-------|-------|
| Server URL | `wss://your-project.livekit.cloud` |
| API Key | Your LiveKit API Key |
| API Secret | Your LiveKit API Secret |

## Credentials

- **LiveKit Cloud**: https://cloud.livekit.io → Project Settings → Keys
- **Deepgram** (free STT): https://console.deepgram.com
- **OpenAI**: https://platform.openai.com/api-keys

## Customizing the Agent

Edit `agent.py`:
- Change `instructions` in `LatticeAssistant.__init__` to customize the system prompt
- Swap `deepgram.STT` for another STT provider
- Swap `openai.LLM` for `anthropic.LLM` or `google.LLM`
- Swap `openai.TTS` for `elevenlabs.TTS` for higher quality voice
- Add `@function_tool` methods to let the agent interact with your workbench
