#!/usr/bin/env node

/**
 * Test MCP client for Blaze Gallery MCP Server
 * Usage: node test-client.js [--db-path /path/to/db] [tool_name] [args...]
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class MCPTestClient {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.serverProcess = null;
  }

  async startServer() {
    const serverScript = join(__dirname, 'dist', 'index.js');
    const args = this.dbPath ? ['--db-path', this.dbPath] : [];
    
    this.serverProcess = spawn('node', [serverScript, ...args], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    // Wait a bit for server to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  async sendRequest(request) {
    return new Promise((resolve, reject) => {
      let response = '';
      let errorResponse = '';

      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, 10000);

      this.serverProcess.stdout.on('data', (data) => {
        response += data.toString();
        
        // Try to parse complete JSON responses
        const lines = response.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const parsed = JSON.parse(line);
              clearTimeout(timeout);
              resolve(parsed);
              return;
            } catch (e) {
              // Not complete JSON yet, continue collecting
            }
          }
        }
      });

      this.serverProcess.stdout.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      // Send request
      this.serverProcess.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  async listTools() {
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    };

    try {
      const response = await this.sendRequest(request);
      console.log('\n=== Available Tools ===');
      response.result.tools.forEach(tool => {
        console.log(`\n${tool.name}: ${tool.description}`);
      });
      return response.result.tools;
    } catch (error) {
      console.error('Error listing tools:', error.message);
      return [];
    }
  }

  async callTool(toolName, args = {}) {
    const request = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    };

    try {
      const response = await this.sendRequest(request);
      console.log(`\n=== ${toolName} Results ===`);
      
      if (response.result && response.result.content) {
        response.result.content.forEach(content => {
          if (content.type === 'text') {
            try {
              const parsed = JSON.parse(content.text);
              console.log(JSON.stringify(parsed, null, 2));
            } catch (e) {
              console.log(content.text);
            }
          }
        });
      } else {
        console.log(JSON.stringify(response, null, 2));
      }
      
      return response;
    } catch (error) {
      console.error(`Error calling ${toolName}:`, error.message);
      return null;
    }
  }

  async runTests() {
    console.log('🧪 Running MCP Server Tests...\n');
    
    // Test 1: List tools
    await this.listTools();

    // Test 2: Get gallery stats
    console.log('\n📊 Testing gallery stats...');
    await this.callTool('get_gallery_stats');

    // Test 3: Get recent photos
    console.log('\n📷 Testing recent photos...');
    await this.callTool('get_recent_photos', { limit: 5 });

    // Test 4: Search photos
    console.log('\n🔍 Testing photo search...');
    await this.callTool('search_photos', { 
      limit: 3,
      is_favorite: true 
    });

    // Test 5: Get photo analytics by year
    console.log('\n📈 Testing photo analytics by year...');
    await this.callTool('get_photo_analytics', {
      groupBy: 'year',
      orderBy: 'count',
      orderDirection: 'DESC',
      limit: 5
    });

    // Test 6: Get photo analytics by month
    console.log('\n📅 Testing photo analytics by month...');
    await this.callTool('get_photo_analytics', {
      groupBy: 'month',
      orderBy: 'period',
      orderDirection: 'DESC',
      limit: 10
    });

    // Test 7: Get photo trends
    console.log('\n📊 Testing photo trends...');
    await this.callTool('get_photo_trends', {
      timeRange: 'last-year',
      groupBy: 'month',
      metric: 'count'
    });

    // Test 8: Get folders
    console.log('\n📁 Testing folder search...');
    await this.callTool('search_folders', { limit: 5 });
  }

  async close() {
    if (this.serverProcess) {
      this.serverProcess.kill();
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  let dbPath = null;
  let toolName = null;
  let toolArgs = {};

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db-path' && i + 1 < args.length) {
      dbPath = args[i + 1];
      i++; // skip next argument
    } else if (!toolName && !args[i].startsWith('--')) {
      toolName = args[i];
    } else if (toolName && !args[i].startsWith('--')) {
      // Parse JSON args
      try {
        toolArgs = JSON.parse(args[i]);
      } catch (e) {
        console.error('Invalid JSON arguments:', args[i]);
        process.exit(1);
      }
    }
  }

  const client = new MCPTestClient(dbPath);

  try {
    await client.startServer();
    
    if (toolName) {
      // Call specific tool
      await client.callTool(toolName, toolArgs);
    } else {
      // Run all tests
      await client.runTests();
    }
  } catch (error) {
    console.error('Test client error:', error);
  } finally {
    await client.close();
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\nShutting down test client...');
  process.exit(0);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}