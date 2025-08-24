#!/bin/bash

# Setup script for Blaze Gallery MCP Server
set -e

echo "🔧 Setting up Blaze Gallery MCP Server..."

# Get the current directory (Blaze Gallery root)
GALLERY_ROOT=$(pwd)
MCP_DIR="$GALLERY_ROOT/mcp-server"

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "src" ]; then
    echo "❌ Please run this script from the Blaze Gallery root directory"
    exit 1
fi

# Switch to the correct Node.js version
echo "🔧 Switching to Node.js v22.13.0 (required for Claude Desktop compatibility)..."
if command -v nvm &> /dev/null; then
    cd "$MCP_DIR"
    nvm use
    cd "$GALLERY_ROOT"
else
    echo "⚠️  nvm not found. Please ensure you're using Node.js v22.13.0"
    echo "   Current version: $(node --version)"
fi

# Install MCP dependencies
echo "📦 Installing MCP server dependencies..."
cd "$MCP_DIR"
npm install

# Build the MCP server
echo "🏗️  Building MCP server..."
npm run build

# Verify the build
if [ ! -f "$MCP_DIR/dist/index.js" ]; then
    echo "❌ Build failed - dist/index.js not found"
    exit 1
fi

echo "✅ MCP server built successfully!"

# Check if database exists
DB_PATH="$GALLERY_ROOT/data/database/gallery.db"
if [ ! -f "$DB_PATH" ]; then
    echo "⚠️  Warning: Database file not found at $DB_PATH"
    echo "   Make sure to run your Blaze Gallery sync process first"
else
    echo "✅ Database found at $DB_PATH"
fi

# Create Claude Desktop config snippet
echo ""
echo "🤖 To configure Claude Desktop, add this to your claude_desktop_config.json:"
echo ""
echo "{"
echo "  \"mcpServers\": {"
echo "    \"blaze-gallery\": {"
echo "      \"command\": \"node\","
echo "      \"args\": [\"$MCP_DIR/dist/index.js\"],"
echo "      \"cwd\": \"$GALLERY_ROOT\""
echo "    }"
echo "  }"
echo "}"
echo ""

# Detect Claude Desktop config path
CLAUDE_CONFIG=""
if [[ "$OSTYPE" == "darwin"* ]]; then
    CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    CLAUDE_CONFIG="$APPDATA/Claude/claude_desktop_config.json"
fi

if [ -n "$CLAUDE_CONFIG" ]; then
    echo "📍 Claude Desktop config location: $CLAUDE_CONFIG"
    
    if [ -f "$CLAUDE_CONFIG" ]; then
        echo "   (Config file already exists - you'll need to merge the above configuration)"
    else
        echo "   (You'll need to create this file with the above configuration)"
    fi
fi

echo ""
echo "🎉 Setup complete! After configuring Claude Desktop:"
echo "   1. Restart Claude Desktop completely"
echo "   2. Try asking: 'What are my gallery statistics?'"
echo "   3. Or: 'Show me my recent photos'"