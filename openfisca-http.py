"""Run OpenFisca-Japan-MCP over Streamable HTTP for the local navigator."""

import os

os.environ.setdefault("PENDULUM_EXTENSIONS", "0")

from openfisca_japan_mcp.server import mcp


if __name__ == "__main__":
    mcp.run(transport="http", host="127.0.0.1", port=8791)
