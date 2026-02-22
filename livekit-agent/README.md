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
- Speak back using OpenAI TTS  ← **you will hear this in the workbench**
- Send messages to the workbench chat via LiveKit RPC

## Workbench Configuration

In the workbench: **Settings → Providers → LiveKit**

| Field | Value |
|-------|-------|
| Server URL | `wss://your-project.livekit.cloud` |
| API Key | Your LiveKit API Key |
| API Secret | Your LiveKit API Secret |

## Avatar Video (optional)

To render a talking-head avatar video in the workbench (visible in the video tile):

1. Install the Anam plugin:
   ```bash
   pip install 'livekit-agents[anam]~=1.3'
   ```

2. Get an API key at https://app.anam.ai

3. Add to your `.env`:
   ```
   ANAM_API_KEY=your-key-here
   ANAM_PERSONA_ID=optional-persona-id
   ```

The agent automatically detects `ANAM_API_KEY` and enables avatar video.
Without the key it runs in voice-only mode.

## Credentials

- **LiveKit Cloud**: https://cloud.livekit.io → Project Settings → Keys
- **Deepgram** (free STT): https://console.deepgram.com
- **OpenAI**: https://platform.openai.com/api-keys
- **Anam** (avatar video): https://app.anam.ai

## Customizing the Agent

Edit `agent.py`:
- Change `instructions` in `LatticeAssistant.__init__` to customize the system prompt
- Swap `deepgram.STT` for another STT provider
- Swap `openai.LLM` for `anthropic.LLM` or `google.LLM`
- Swap `openai.TTS` for `elevenlabs.TTS` for higher quality voice
- Add `@function_tool` methods to let the agent interact with your workbench
