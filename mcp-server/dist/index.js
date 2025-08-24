#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const commander_1 = require("commander");
const database_js_1 = require("./database.js");
class BlazeGalleryMCPServer {
    server;
    db;
    constructor(dbPath) {
        this.server = new index_js_1.Server({
            name: 'blaze-gallery-mcp-server',
            version: '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.db = new database_js_1.GalleryDatabase(dbPath);
        this.setupToolHandlers();
        this.setupErrorHandler();
    }
    setupErrorHandler() {
        this.server.onerror = (error) => {
            console.error('[MCP Error]', error);
        };
        process.on('SIGINT', async () => {
            this.db.close();
            await this.server.close();
            process.exit(0);
        });
    }
    setupToolHandlers() {
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: 'search_photos',
                        description: 'Search for photos in the gallery with various filters',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                folder_path: {
                                    type: 'string',
                                    description: 'Filter by folder path (supports nested paths)',
                                },
                                filename: {
                                    type: 'string',
                                    description: 'Filter by filename (partial match)',
                                },
                                mime_type: {
                                    type: 'string',
                                    description: 'Filter by MIME type (e.g., "image/jpeg")',
                                },
                                is_favorite: {
                                    type: 'boolean',
                                    description: 'Filter by favorite status',
                                },
                                has_metadata: {
                                    type: 'boolean',
                                    description: 'Filter by whether photo has EXIF metadata',
                                },
                                min_size: {
                                    type: 'number',
                                    description: 'Minimum file size in bytes',
                                },
                                max_size: {
                                    type: 'number',
                                    description: 'Maximum file size in bytes',
                                },
                                date_from: {
                                    type: 'string',
                                    description: 'Filter photos modified after this date (ISO format)',
                                },
                                date_to: {
                                    type: 'string',
                                    description: 'Filter photos modified before this date (ISO format)',
                                },
                                limit: {
                                    type: 'number',
                                    description: 'Maximum number of results (default: 100)',
                                    default: 100,
                                },
                                offset: {
                                    type: 'number',
                                    description: 'Number of results to skip (for pagination)',
                                    default: 0,
                                },
                            },
                        },
                    },
                    {
                        name: 'get_photo',
                        description: 'Get detailed information about a specific photo by ID',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                photo_id: {
                                    type: 'number',
                                    description: 'The photo ID to retrieve',
                                },
                            },
                            required: ['photo_id'],
                        },
                    },
                    {
                        name: 'search_folders',
                        description: 'Search for folders in the gallery with various filters',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                parent_path: {
                                    type: 'string',
                                    description: 'Filter by parent folder path (use empty string for root folders)',
                                },
                                folder_name: {
                                    type: 'string',
                                    description: 'Filter by folder name (partial match)',
                                },
                                has_photos: {
                                    type: 'boolean',
                                    description: 'Filter by whether folder contains photos',
                                },
                                min_photo_count: {
                                    type: 'number',
                                    description: 'Minimum number of photos in folder',
                                },
                                max_photo_count: {
                                    type: 'number',
                                    description: 'Maximum number of photos in folder',
                                },
                                limit: {
                                    type: 'number',
                                    description: 'Maximum number of results (default: 100)',
                                    default: 100,
                                },
                                offset: {
                                    type: 'number',
                                    description: 'Number of results to skip (for pagination)',
                                    default: 0,
                                },
                            },
                        },
                    },
                    {
                        name: 'get_folder',
                        description: 'Get detailed information about a specific folder by path',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                folder_path: {
                                    type: 'string',
                                    description: 'The folder path to retrieve',
                                },
                            },
                            required: ['folder_path'],
                        },
                    },
                    {
                        name: 'get_folder_photos',
                        description: 'Get all photos in a specific folder',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                folder_path: {
                                    type: 'string',
                                    description: 'The folder path to get photos from',
                                },
                                limit: {
                                    type: 'number',
                                    description: 'Maximum number of results (default: 100)',
                                    default: 100,
                                },
                            },
                            required: ['folder_path'],
                        },
                    },
                    {
                        name: 'get_folder_tree',
                        description: 'Get the folder hierarchy/tree structure',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                root_path: {
                                    type: 'string',
                                    description: 'Root path to start the tree from (empty for root folders)',
                                },
                            },
                        },
                    },
                    {
                        name: 'get_favorite_photos',
                        description: 'Get all favorite photos',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                limit: {
                                    type: 'number',
                                    description: 'Maximum number of results (default: 100)',
                                    default: 100,
                                },
                            },
                        },
                    },
                    {
                        name: 'get_recent_photos',
                        description: 'Get recently added/modified photos',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                limit: {
                                    type: 'number',
                                    description: 'Maximum number of results (default: 50)',
                                    default: 50,
                                },
                            },
                        },
                    },
                    {
                        name: 'get_gallery_stats',
                        description: 'Get overall gallery statistics and metrics',
                        inputSchema: {
                            type: 'object',
                            properties: {},
                        },
                    },
                ],
            };
        });
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
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
                            throw new types_js_1.McpError(types_js_1.ErrorCode.InvalidRequest, 'photo_id is required and must be a number');
                        }
                        const photo = await this.db.getPhoto(args.photo_id);
                        if (!photo) {
                            throw new types_js_1.McpError(types_js_1.ErrorCode.InvalidRequest, `Photo with ID ${args.photo_id} not found`);
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
                            throw new types_js_1.McpError(types_js_1.ErrorCode.InvalidRequest, 'folder_path is required and must be a string');
                        }
                        const folder = await this.db.getFolderByPath(args.folder_path);
                        if (!folder) {
                            throw new types_js_1.McpError(types_js_1.ErrorCode.InvalidRequest, `Folder with path "${args.folder_path}" not found`);
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
                            throw new types_js_1.McpError(types_js_1.ErrorCode.InvalidRequest, 'folder_path is required and must be a string');
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
                        throw new types_js_1.McpError(types_js_1.ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
                }
            }
            catch (error) {
                if (error instanceof types_js_1.McpError) {
                    throw error;
                }
                console.error(`Error executing ${name}:`, error);
                throw new types_js_1.McpError(types_js_1.ErrorCode.InternalError, `Failed to execute ${name}: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }
    async run() {
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        console.error('Blaze Gallery MCP server running on stdio');
    }
}
// CLI setup
const program = new commander_1.Command();
program
    .name('blaze-gallery-mcp')
    .description('MCP server for Blaze Gallery')
    .version('1.0.0')
    .option('--db-path <path>', 'Path to the SQLite database file')
    .action(async (options) => {
    const server = new BlazeGalleryMCPServer(options.dbPath);
    await server.run();
});
program.parse();
//# sourceMappingURL=index.js.map