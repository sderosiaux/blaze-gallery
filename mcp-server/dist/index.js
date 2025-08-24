#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const commander_1 = require("commander");
const database_js_1 = require("./database.js");
const schemas_js_1 = require("./schemas.js");
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
        try {
            this.db = new database_js_1.GalleryDatabase(dbPath);
            this.setupToolHandlers();
            this.setupErrorHandler();
        }
        catch (error) {
            console.error('[MCP Server Error] Failed to initialize database:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
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
                        inputSchema: schemas_js_1.toolSchemas.search_photos.inputSchema,
                        outputSchema: schemas_js_1.toolSchemas.search_photos.outputSchema,
                    },
                    {
                        name: 'get_photo',
                        description: 'Get detailed information about a specific photo by ID',
                        inputSchema: schemas_js_1.toolSchemas.get_photo.inputSchema,
                        outputSchema: schemas_js_1.toolSchemas.get_photo.outputSchema,
                    },
                    {
                        name: 'search_folders',
                        description: 'Search for folders in the gallery with various filters',
                        inputSchema: schemas_js_1.toolSchemas.search_folders.inputSchema,
                        outputSchema: schemas_js_1.toolSchemas.search_folders.outputSchema,
                    },
                    {
                        name: 'get_folder',
                        description: 'Get detailed information about a specific folder by path',
                        inputSchema: schemas_js_1.toolSchemas.get_folder.inputSchema,
                        outputSchema: schemas_js_1.toolSchemas.get_folder.outputSchema,
                    },
                    {
                        name: 'get_folder_photos',
                        description: 'Get all photos in a specific folder',
                        inputSchema: schemas_js_1.toolSchemas.get_folder_photos.inputSchema,
                        outputSchema: schemas_js_1.toolSchemas.get_folder_photos.outputSchema,
                    },
                    {
                        name: 'get_folder_tree',
                        description: 'Get the folder hierarchy/tree structure',
                        inputSchema: schemas_js_1.toolSchemas.get_folder_tree.inputSchema,
                        outputSchema: schemas_js_1.toolSchemas.get_folder_tree.outputSchema,
                    },
                    {
                        name: 'get_favorite_photos',
                        description: 'Get all favorite photos',
                        inputSchema: schemas_js_1.toolSchemas.get_favorite_photos.inputSchema,
                        outputSchema: schemas_js_1.toolSchemas.get_favorite_photos.outputSchema,
                    },
                    {
                        name: 'get_recent_photos',
                        description: 'Get recently added/modified photos',
                        inputSchema: schemas_js_1.toolSchemas.get_recent_photos.inputSchema,
                        outputSchema: schemas_js_1.toolSchemas.get_recent_photos.outputSchema,
                    },
                    {
                        name: 'get_gallery_stats',
                        description: 'Get overall gallery statistics and metrics',
                        inputSchema: schemas_js_1.toolSchemas.get_gallery_stats.inputSchema,
                        outputSchema: schemas_js_1.toolSchemas.get_gallery_stats.outputSchema,
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