// Shared JSON schemas for MCP tools

export const photoSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'number' as const },
    folder_id: { type: 'number' as const },
    filename: { type: 'string' as const },
    s3_key: { type: 'string' as const },
    size: { type: 'number' as const },
    mime_type: { type: 'string' as const },
    created_at: { type: 'string' as const },
    modified_at: { type: 'string' as const },
    thumbnail_path: { type: 'string' as const },
    metadata_status: { type: 'string' as const },
    thumbnail_status: { type: 'string' as const },
    is_favorite: { type: 'boolean' as const },
    last_synced: { type: 'string' as const },
    thumbnail_url: { type: 'string' as const },
    metadata: {
      type: 'object' as const,
      properties: {
        width: { type: 'number' as const },
        height: { type: 'number' as const },
        make: { type: 'string' as const },
        model: { type: 'string' as const },
        orientation: { type: 'number' as const },
        dateTime: { type: 'string' as const },
        gps: {
          type: 'object' as const,
          properties: {
            latitude: { type: 'number' as const },
            longitude: { type: 'number' as const },
            altitude: { type: 'number' as const },
          },
        },
      },
    },
  },
};

export const folderSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'number' as const },
    path: { type: 'string' as const },
    name: { type: 'string' as const },
    parent_id: { type: 'number' as const },
    created_at: { type: 'string' as const },
    updated_at: { type: 'string' as const },
    last_synced: { type: 'string' as const },
    last_visited: { type: 'string' as const },
    photo_count: { type: 'number' as const },
    subfolder_count: { type: 'number' as const },
    thumbnails_generated: { type: 'boolean' as const },
    total_size: { type: 'number' as const },
    folder_created_at: { type: 'string' as const },
  },
};

export const toolSchemas = {
  search_photos: {
    inputSchema: {
      type: 'object' as const,
      properties: {
        folder_path: { type: 'string' as const, description: 'Filter by folder path (supports nested paths)' },
        filename: { type: 'string' as const, description: 'Filter by filename (partial match)' },
        mime_type: { type: 'string' as const, description: 'Filter by MIME type (e.g., "image/jpeg")' },
        is_favorite: { type: 'boolean' as const, description: 'Filter by favorite status' },
        has_metadata: { type: 'boolean' as const, description: 'Filter by whether photo has EXIF metadata' },
        min_size: { type: 'number' as const, description: 'Minimum file size in bytes' },
        max_size: { type: 'number' as const, description: 'Maximum file size in bytes' },
        date_from: { type: 'string' as const, description: 'Filter photos modified after this date (ISO format)' },
        date_to: { type: 'string' as const, description: 'Filter photos modified before this date (ISO format)' },
        limit: { type: 'number' as const, description: 'Maximum number of results (default: 100)', default: 100 },
        offset: { type: 'number' as const, description: 'Number of results to skip (for pagination)', default: 0 },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        photos: { type: 'array' as const, items: photoSchema },
        count: { type: 'number' as const },
      },
      required: ['photos', 'count'],
    },
  },

  get_photo: {
    inputSchema: {
      type: 'object' as const,
      properties: {
        photo_id: { type: 'number' as const, description: 'The photo ID to retrieve' },
      },
      required: ['photo_id'],
    },
    outputSchema: photoSchema,
  },

  search_folders: {
    inputSchema: {
      type: 'object' as const,
      properties: {
        parent_path: { type: 'string' as const, description: 'Filter by parent folder path (use empty string for root folders)' },
        folder_name: { type: 'string' as const, description: 'Filter by folder name (partial match)' },
        has_photos: { type: 'boolean' as const, description: 'Filter by whether folder contains photos' },
        min_photo_count: { type: 'number' as const, description: 'Minimum number of photos in folder' },
        max_photo_count: { type: 'number' as const, description: 'Maximum number of photos in folder' },
        limit: { type: 'number' as const, description: 'Maximum number of results (default: 100)', default: 100 },
        offset: { type: 'number' as const, description: 'Number of results to skip (for pagination)', default: 0 },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        folders: { type: 'array' as const, items: folderSchema },
        count: { type: 'number' as const },
      },
      required: ['folders', 'count'],
    },
  },

  get_folder: {
    inputSchema: {
      type: 'object' as const,
      properties: {
        folder_path: { type: 'string' as const, description: 'The folder path to retrieve' },
      },
      required: ['folder_path'],
    },
    outputSchema: folderSchema,
  },

  get_folder_photos: {
    inputSchema: {
      type: 'object' as const,
      properties: {
        folder_path: { type: 'string' as const, description: 'The folder path to get photos from' },
        limit: { type: 'number' as const, description: 'Maximum number of results (default: 100)', default: 100 },
      },
      required: ['folder_path'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        folder_path: { type: 'string' as const },
        photos: { type: 'array' as const, items: photoSchema },
        count: { type: 'number' as const },
      },
      required: ['folder_path', 'photos', 'count'],
    },
  },

  get_folder_tree: {
    inputSchema: {
      type: 'object' as const,
      properties: {
        root_path: { type: 'string' as const, description: 'Root path to start the tree from (empty for root folders)' },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        root_path: { type: 'string' as const },
        folders: { type: 'array' as const, items: folderSchema },
        count: { type: 'number' as const },
      },
      required: ['root_path', 'folders', 'count'],
    },
  },

  get_favorite_photos: {
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number' as const, description: 'Maximum number of results (default: 100)', default: 100 },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        favorite_photos: { type: 'array' as const, items: photoSchema },
        count: { type: 'number' as const },
      },
      required: ['favorite_photos', 'count'],
    },
  },

  get_recent_photos: {
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number' as const, description: 'Maximum number of results (default: 50)', default: 50 },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        recent_photos: { type: 'array' as const, items: photoSchema },
        count: { type: 'number' as const },
      },
      required: ['recent_photos', 'count'],
    },
  },

  get_gallery_stats: {
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        total_photos: { type: 'number' as const },
        total_folders: { type: 'number' as const },
        total_size: { type: 'number' as const },
        favorite_photos: { type: 'number' as const },
        photos_with_metadata: { type: 'number' as const },
      },
      required: ['total_photos', 'total_folders', 'total_size', 'favorite_photos', 'photos_with_metadata'],
    },
  },
};