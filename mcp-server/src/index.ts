#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { Command } from 'commander';
import { GalleryDatabase } from './database.js';
import { toolSchemas } from './schemas.js';

class BlazeGalleryMCPServer {
  private server: Server;
  private db: GalleryDatabase;

  constructor(dbPath?: string) {
    this.server = new Server(
      {
        name: 'blaze-gallery-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    try {
      this.db = new GalleryDatabase(dbPath);
      this.setupToolHandlers();
      this.setupErrorHandler();
    } catch (error) {
      console.error('[MCP Server Error] Failed to initialize database:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  private setupErrorHandler(): void {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      this.db.close();
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'search_photos',
            description: 'Search for photos in the gallery with various filters',
            inputSchema: toolSchemas.search_photos.inputSchema,
            outputSchema: toolSchemas.search_photos.outputSchema,
          },
          {
            name: 'get_photo',
            description: 'Get detailed information about a specific photo by ID',
            inputSchema: toolSchemas.get_photo.inputSchema,
            outputSchema: toolSchemas.get_photo.outputSchema,
          },
          {
            name: 'search_folders',
            description: 'Search for folders in the gallery with various filters',
            inputSchema: toolSchemas.search_folders.inputSchema,
            outputSchema: toolSchemas.search_folders.outputSchema,
          },
          {
            name: 'get_folder',
            description: 'Get detailed information about a specific folder by path',
            inputSchema: toolSchemas.get_folder.inputSchema,
            outputSchema: toolSchemas.get_folder.outputSchema,
          },
          {
            name: 'get_folder_photos',
            description: 'Get all photos in a specific folder',
            inputSchema: toolSchemas.get_folder_photos.inputSchema,
            outputSchema: toolSchemas.get_folder_photos.outputSchema,
          },
          {
            name: 'get_folder_tree',
            description: 'Get the folder hierarchy/tree structure',
            inputSchema: toolSchemas.get_folder_tree.inputSchema,
            outputSchema: toolSchemas.get_folder_tree.outputSchema,
          },
          {
            name: 'get_favorite_photos',
            description: 'Get all favorite photos',
            inputSchema: toolSchemas.get_favorite_photos.inputSchema,
            outputSchema: toolSchemas.get_favorite_photos.outputSchema,
          },
          {
            name: 'get_recent_photos',
            description: 'Get recently added/modified photos',
            inputSchema: toolSchemas.get_recent_photos.inputSchema,
            outputSchema: toolSchemas.get_recent_photos.outputSchema,
          },
          {
            name: 'get_gallery_stats',
            description: 'Get overall gallery statistics and metrics',
            inputSchema: toolSchemas.get_gallery_stats.inputSchema,
            outputSchema: toolSchemas.get_gallery_stats.outputSchema,
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'search_photos': {
            const results = await this.db.searchPhotos(args || {});
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    photos: results,
                    count: results.length,
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_photo': {
            if (!args || typeof args.photo_id !== 'number') {
              throw new McpError(ErrorCode.InvalidRequest, 'photo_id is required and must be a number');
            }
            const photo = await this.db.getPhoto(args.photo_id);
            if (!photo) {
              throw new McpError(ErrorCode.InvalidRequest, `Photo with ID ${args.photo_id} not found`);
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(photo, null, 2),
                },
              ],
            };
          }

          case 'search_folders': {
            const results = await this.db.searchFolders(args || {});
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    folders: results,
                    count: results.length,
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_folder': {
            if (!args || typeof args.folder_path !== 'string') {
              throw new McpError(ErrorCode.InvalidRequest, 'folder_path is required and must be a string');
            }
            const folder = await this.db.getFolderByPath(args.folder_path);
            if (!folder) {
              throw new McpError(ErrorCode.InvalidRequest, `Folder with path "${args.folder_path}" not found`);
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(folder, null, 2),
                },
              ],
            };
          }

          case 'get_folder_photos': {
            if (!args || typeof args.folder_path !== 'string') {
              throw new McpError(ErrorCode.InvalidRequest, 'folder_path is required and must be a string');
            }
            const limit = typeof args.limit === 'number' ? args.limit : 100;
            const photos = await this.db.getPhotosByFolder(args.folder_path, limit);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    folder_path: args.folder_path,
                    photos: photos,
                    count: photos.length,
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_folder_tree': {
            const rootPath = args && typeof args.root_path === 'string' ? args.root_path : undefined;
            const folders = await this.db.getFolderTree(rootPath);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    root_path: rootPath || '',
                    folders: folders,
                    count: folders.length,
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_favorite_photos': {
            const limit = args && typeof args.limit === 'number' ? args.limit : 100;
            const photos = await this.db.getFavoritePhotos(limit);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    favorite_photos: photos,
                    count: photos.length,
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_recent_photos': {
            const limit = args && typeof args.limit === 'number' ? args.limit : 50;
            const photos = await this.db.getRecentPhotos(limit);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    recent_photos: photos,
                    count: photos.length,
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_gallery_stats': {
            const stats = await this.db.getGalleryStats();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(stats, null, 2),
                },
              ],
            };
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        console.error(`Error executing ${name}:`, error);
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to execute ${name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Blaze Gallery MCP server running on stdio');
  }
}

// CLI setup
const program = new Command();
program
  .name('blaze-gallery-mcp')
  .description('MCP server for Blaze Gallery')
  .version('1.0.0')
  .option('--db-path <path>', 'Path to the SQLite database file')
  .action(async (options) => {
    const server = new BlazeGalleryMCPServer(options.dbPath);
    await server.run();
  });

program.parse([]);