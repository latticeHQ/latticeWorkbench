"""
Simplified OpenBB API launcher for Lattice Workbench embedding.

Non-interactive, no prompts, prints READY signal for process manager detection.
Usage: python launch_server.py --port 6900
"""

import argparse
import os
import sys
import signal
import logging

# Suppress noisy startup logs
logging.basicConfig(level=logging.WARNING)


def main():
    parser = argparse.ArgumentParser(description="OpenBB API Server (Lattice-managed)")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host")
    parser.add_argument("--port", type=int, default=6900, help="Bind port")
    args = parser.parse_args()

    # Set environment before importing OpenBB
    os.environ["OPENBB_API_AUTH"] = "false"
    os.environ["OPENBB_AUTO_BUILD"] = "false"
    os.environ["OPENBB_API_HOST"] = args.host
    os.environ["OPENBB_API_PORT"] = str(args.port)

    # Import the FastAPI app
    from openbb_core.api.rest_api import app  # noqa: E402

    import uvicorn

    # Add health check endpoint
    from fastapi.responses import JSONResponse

    @app.get("/healthz")
    async def healthz():
        return JSONResponse({"status": "ok"})

    # Print ready signal after server starts
    class ReadyServer(uvicorn.Server):
        def startup(self, sockets=None):
            result = super().startup(sockets)
            # Signal to parent process that we're ready
            print(f"OPENBB_READY port={args.port}", flush=True)
            return result

    config = uvicorn.Config(
        app,
        host=args.host,
        port=args.port,
        log_level="warning",
        access_log=False,
    )

    server = uvicorn.Server(config)

    # Graceful shutdown on SIGTERM
    def handle_sigterm(sig, frame):
        server.should_exit = True

    signal.signal(signal.SIGTERM, handle_sigterm)

    print(f"Starting OpenBB API on {args.host}:{args.port}...", flush=True)
    server.run()


if __name__ == "__main__":
    main()
