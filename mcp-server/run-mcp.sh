#!/bin/bash

# Wrapper script to run MCP server with correct Node.js environment
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Use the specific Node.js version
NODE_PATH="/Users/sderosiaux/.nvm/versions/node/v22.13.0/bin/node"

# Change to MCP server directory to ensure correct working directory
cd "$(dirname "$0")"

# Run the MCP server with the correct Node version
exec "$NODE_PATH" dist/index.js "$@"