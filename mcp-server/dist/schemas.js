// Shared JSON schemas for MCP tools
export const photoSchema = {
    type: 'object',
    properties: {
        id: { type: 'number' },
        folder_id: { type: 'number' },
        filename: { type: 'string' },
        s3_key: { type: 'string' },
        size: { type: 'number' },
        mime_type: { type: 'string' },
        created_at: { type: 'string' },
        modified_at: { type: 'string' },
        thumbnail_path: { type: 'string' },
        metadata_status: { type: 'string' },
        thumbnail_status: { type: 'string' },
        is_favorite: { type: 'boolean' },
        last_synced: { type: 'string' },
        thumbnail_url: { type: 'string' },
        metadata: {
            type: 'object',
            properties: {
                width: { type: 'number' },
                height: { type: 'number' },
                make: { type: 'string' },
                model: { type: 'string' },
                orientation: { type: 'number' },
                dateTime: { type: 'string' },
                gps: {
                    type: 'object',
                    properties: {
                        latitude: { type: 'number' },
                        longitude: { type: 'number' },
                        altitude: { type: 'number' },
                    },
                },
            },
        },
    },
};
export const folderSchema = {
    type: 'object',
    properties: {
        id: { type: 'number' },
        path: { type: 'string' },
        name: { type: 'string' },
        parent_id: { type: 'number' },
        created_at: { type: 'string' },
        updated_at: { type: 'string' },
        last_synced: { type: 'string' },
        last_visited: { type: 'string' },
        photo_count: { type: 'number' },
        subfolder_count: { type: 'number' },
        thumbnails_generated: { type: 'boolean' },
        total_size: { type: 'number' },
        folder_created_at: { type: 'string' },
    },
};
export const toolSchemas = {
    search_photos: {
        inputSchema: {
            type: 'object',
            properties: {
                folder_path: { type: 'string', description: 'Filter by folder path (supports nested paths)' },
                filename: { type: 'string', description: 'Filter by filename (partial match)' },
                mime_type: { type: 'string', description: 'Filter by MIME type (e.g., "image/jpeg")' },
                is_favorite: { type: 'boolean', description: 'Filter by favorite status' },
                has_metadata: { type: 'boolean', description: 'Filter by whether photo has EXIF metadata' },
                min_size: { type: 'number', description: 'Minimum file size in bytes' },
                max_size: { type: 'number', description: 'Maximum file size in bytes' },
                date_from: { type: 'string', description: 'Filter photos modified after this date (ISO format)' },
                date_to: { type: 'string', description: 'Filter photos modified before this date (ISO format)' },
                limit: { type: 'number', description: 'Maximum number of results (default: 100)', default: 100 },
                offset: { type: 'number', description: 'Number of results to skip (for pagination)', default: 0 },
            },
        },
        outputSchema: {
            type: 'object',
            properties: {
                photos: { type: 'array', items: photoSchema },
                count: { type: 'number' },
            },
            required: ['photos', 'count'],
        },
    },
    get_photo: {
        inputSchema: {
            type: 'object',
            properties: {
                photo_id: { type: 'number', description: 'The photo ID to retrieve' },
            },
            required: ['photo_id'],
        },
        outputSchema: photoSchema,
    },
    search_folders: {
        inputSchema: {
            type: 'object',
            properties: {
                parent_path: { type: 'string', description: 'Filter by parent folder path (use empty string for root folders)' },
                folder_name: { type: 'string', description: 'Filter by folder name (partial match)' },
                has_photos: { type: 'boolean', description: 'Filter by whether folder contains photos' },
                min_photo_count: { type: 'number', description: 'Minimum number of photos in folder' },
                max_photo_count: { type: 'number', description: 'Maximum number of photos in folder' },
                limit: { type: 'number', description: 'Maximum number of results (default: 100)', default: 100 },
                offset: { type: 'number', description: 'Number of results to skip (for pagination)', default: 0 },
            },
        },
        outputSchema: {
            type: 'object',
            properties: {
                folders: { type: 'array', items: folderSchema },
                count: { type: 'number' },
            },
            required: ['folders', 'count'],
        },
    },
    get_folder: {
        inputSchema: {
            type: 'object',
            properties: {
                folder_path: { type: 'string', description: 'The folder path to retrieve' },
            },
            required: ['folder_path'],
        },
        outputSchema: folderSchema,
    },
    get_folder_photos: {
        inputSchema: {
            type: 'object',
            properties: {
                folder_path: { type: 'string', description: 'The folder path to get photos from' },
                limit: { type: 'number', description: 'Maximum number of results (default: 100)', default: 100 },
            },
            required: ['folder_path'],
        },
        outputSchema: {
            type: 'object',
            properties: {
                folder_path: { type: 'string' },
                photos: { type: 'array', items: photoSchema },
                count: { type: 'number' },
            },
            required: ['folder_path', 'photos', 'count'],
        },
    },
    get_folder_tree: {
        inputSchema: {
            type: 'object',
            properties: {
                root_path: { type: 'string', description: 'Root path to start the tree from (empty for root folders)' },
            },
        },
        outputSchema: {
            type: 'object',
            properties: {
                root_path: { type: 'string' },
                folders: { type: 'array', items: folderSchema },
                count: { type: 'number' },
            },
            required: ['root_path', 'folders', 'count'],
        },
    },
    get_favorite_photos: {
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Maximum number of results (default: 100)', default: 100 },
            },
        },
        outputSchema: {
            type: 'object',
            properties: {
                favorite_photos: { type: 'array', items: photoSchema },
                count: { type: 'number' },
            },
            required: ['favorite_photos', 'count'],
        },
    },
    get_recent_photos: {
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Maximum number of results (default: 50)', default: 50 },
            },
        },
        outputSchema: {
            type: 'object',
            properties: {
                recent_photos: { type: 'array', items: photoSchema },
                count: { type: 'number' },
            },
            required: ['recent_photos', 'count'],
        },
    },
    get_gallery_stats: {
        inputSchema: {
            type: 'object',
            properties: {},
        },
        outputSchema: {
            type: 'object',
            properties: {
                total_photos: { type: 'number' },
                total_folders: { type: 'number' },
                total_size: { type: 'number' },
                favorite_photos: { type: 'number' },
                photos_with_metadata: { type: 'number' },
            },
            required: ['total_photos', 'total_folders', 'total_size', 'favorite_photos', 'photos_with_metadata'],
        },
    },
    get_photo_analytics: {
        inputSchema: {
            type: 'object',
            properties: {
                groupBy: {
                    type: 'string',
                    enum: ['year', 'month', 'year-month', 'folder'],
                    description: 'How to group the analytics data',
                },
                orderBy: {
                    type: 'string',
                    enum: ['period', 'count', 'size'],
                    description: 'How to order the results',
                    default: 'period',
                },
                orderDirection: {
                    type: 'string',
                    enum: ['ASC', 'DESC'],
                    description: 'Order direction',
                    default: 'DESC',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results (default: 100)',
                    default: 100,
                },
            },
            required: ['groupBy'],
        },
        outputSchema: {
            type: 'object',
            properties: {
                analytics: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            period: { type: 'string' },
                            photo_count: { type: 'number' },
                            total_size: { type: 'number' },
                            favorite_count: { type: 'number' },
                            folders_involved: { type: 'number' },
                        },
                        required: ['period', 'photo_count', 'total_size', 'favorite_count'],
                    },
                },
                groupBy: { type: 'string' },
                count: { type: 'number' },
            },
            required: ['analytics', 'groupBy', 'count'],
        },
    },
    get_photo_trends: {
        inputSchema: {
            type: 'object',
            properties: {
                timeRange: {
                    type: 'string',
                    enum: ['last-30-days', 'last-year', 'all-time'],
                    description: 'Time range for trend analysis',
                    default: 'last-year',
                },
                groupBy: {
                    type: 'string',
                    enum: ['day', 'week', 'month', 'year'],
                    description: 'Time period grouping',
                    default: 'month',
                },
                metric: {
                    type: 'string',
                    enum: ['count', 'size', 'favorites'],
                    description: 'What metric to analyze',
                    default: 'count',
                },
            },
        },
        outputSchema: {
            type: 'object',
            properties: {
                trends: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            period: { type: 'string' },
                            value: { type: 'number' },
                        },
                        required: ['period', 'value'],
                    },
                },
                timeRange: { type: 'string' },
                groupBy: { type: 'string' },
                metric: { type: 'string' },
                count: { type: 'number' },
            },
            required: ['trends', 'timeRange', 'groupBy', 'metric', 'count'],
        },
    },
};
//# sourceMappingURL=schemas.js.map