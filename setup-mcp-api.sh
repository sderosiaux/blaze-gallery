#!/bin/bash

# Setup script for Blaze Gallery MCP Server (API Integration)
set -e

echo "🔧 Setting up Blaze Gallery MCP Server API integration..."

# Get the current directory (Blaze Gallery root)
GALLERY_ROOT=$(pwd)

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "src" ]; then
    echo "❌ Please run this script from the Blaze Gallery root directory"
    exit 1
fi

# Check if MCP API route exists
if [ ! -f "src/app/api/mcp/route.ts" ]; then
    echo "❌ MCP API route not found at src/app/api/mcp/route.ts"
    exit 1
fi

echo "✅ MCP API route found!"

# Check if Next.js app is buildable
echo "🏗️  Checking if Next.js app builds..."
npm run build > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✅ Next.js app builds successfully!"
else
    echo "❌ Next.js app build failed. Please fix build errors first."
    exit 1
fi

# Create a simple MCP client script for testing
cat > mcp-test-client.js << 'EOF'
#!/usr/bin/env node

const API_BASE = process.env.MCP_API_URL || 'http://localhost:3001/api/mcp';

async function testMCP() {
  try {
    console.log('🧪 Testing MCP API integration...');

    // Test tools listing
    const toolsResponse = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'tools/list' })
    });

    if (!toolsResponse.ok) {
      throw new Error(`HTTP ${toolsResponse.status}: ${toolsResponse.statusText}`);
    }

    const tools = await toolsResponse.json();
    console.log(`✅ Found ${tools.tools.length} available tools`);

    // Test gallery stats
    const statsResponse = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'tools/call',
        params: {
          name: 'get_gallery_stats',
          arguments: {}
        }
      })
    });

    if (!statsResponse.ok) {
      throw new Error(`HTTP ${statsResponse.status}: ${statsResponse.statusText}`);
    }

    const stats = await statsResponse.json();
    console.log('✅ Gallery stats retrieved successfully');
    console.log(JSON.parse(stats.content[0].text));

  } catch (error) {
    console.error('❌ MCP API test failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  testMCP();
}
EOF

chmod +x mcp-test-client.js

echo ""
echo "🤖 MCP Server is now integrated into your Next.js API!"
echo ""
echo "📋 Configuration for Claude Desktop:"
echo ""
echo "Instead of a standalone MCP server, you can now use:"
echo ""
echo "Option 1: HTTP MCP Client (recommended)"
echo "{"
echo "  \"mcpServers\": {"
echo "    \"blaze-gallery-api\": {"
echo "      \"command\": \"npx\","
echo "      \"args\": [\"@anthropic-ai/mcp-client-http\", \"http://localhost:3000/api/mcp\"]"
echo "    }"
echo "  }"
echo "}"
echo ""

echo "Option 2: Custom MCP Proxy (if you need it)"
echo "{"
echo "  \"mcpServers\": {"
echo "    \"blaze-gallery-api\": {"
echo "      \"command\": \"node\","
echo "      \"args\": [\"$GALLERY_ROOT/mcp-proxy.js\"],"
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
echo "🧪 To test the MCP API integration:"
echo "   1. Start your Next.js app: npm run dev"
echo "   2. Run the test client: node mcp-test-client.js"
echo ""
echo "🎉 Setup complete! Your MCP server is now part of your Next.js API!"
echo "   • Uses your existing Neon database"
echo "   • Leverages your existing database functions"
echo "   • No separate process needed"
echo "   • Easier to maintain and debug"