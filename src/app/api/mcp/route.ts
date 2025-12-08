import { NextRequest, NextResponse } from "next/server";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  getFolders,
  getFolderByPath,
  getPhotosInFolder,
  getPhoto,
  query,
} from "@/lib/database";
import { Photo, Folder } from "@/types";

interface SearchFilters {
  folder_path?: string;
  filename?: string;
  mime_type?: string;
  is_favorite?: boolean;
  has_metadata?: boolean;
  min_size?: number;
  max_size?: number;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

interface FolderSearchFilters {
  parent_path?: string;
  folder_name?: string;
  has_photos?: boolean;
  min_photo_count?: number;
  max_photo_count?: number;
  limit?: number;
  offset?: number;
}

class BlazeGalleryMCPHandler {
  async searchPhotos(filters: SearchFilters): Promise<Photo[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    // Build WHERE conditions
    if (filters.folder_path) {
      conditions.push(
        `(f.path = $${paramCount} OR f.path LIKE $${paramCount + 1})`,
      );
      params.push(filters.folder_path, `${filters.folder_path}/%`);
      paramCount += 2;
    }

    if (filters.filename) {
      conditions.push(`p.filename ILIKE $${paramCount}`);
      params.push(`%${filters.filename}%`);
      paramCount++;
    }

    if (filters.mime_type) {
      conditions.push(`p.mime_type = $${paramCount}`);
      params.push(filters.mime_type);
      paramCount++;
    }

    if (typeof filters.is_favorite === "boolean") {
      conditions.push(`p.is_favorite = $${paramCount}`);
      params.push(filters.is_favorite);
      paramCount++;
    }

    if (typeof filters.has_metadata === "boolean") {
      conditions.push(
        filters.has_metadata ? "p.metadata IS NOT NULL" : "p.metadata IS NULL",
      );
    }

    if (filters.min_size) {
      conditions.push(`p.size >= $${paramCount}`);
      params.push(filters.min_size);
      paramCount++;
    }

    if (filters.max_size) {
      conditions.push(`p.size <= $${paramCount}`);
      params.push(filters.max_size);
      paramCount++;
    }

    if (filters.date_from) {
      conditions.push(`p.modified_at >= $${paramCount}`);
      params.push(filters.date_from);
      paramCount++;
    }

    if (filters.date_to) {
      conditions.push(`p.modified_at <= $${paramCount}`);
      params.push(filters.date_to);
      paramCount++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filters.limit || 100;
    const offset = filters.offset || 0;

    const queryText = `
      SELECT p.*, f.path as folder_path, f.name as folder_name
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      ${whereClause}
      ORDER BY p.modified_at DESC, p.filename
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    params.push(limit, offset);
    const result = await query(queryText, params);

    return result.rows.map((photo) => ({
      ...photo,
      is_favorite: Boolean(photo.is_favorite),
      thumbnail_url: `/api/photos/${photo.id}/thumbnail`,
      metadata: photo.metadata,
    })) as Photo[];
  }

  async searchFolders(filters: FolderSearchFilters): Promise<Folder[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    if (filters.parent_path !== undefined) {
      if (filters.parent_path === "") {
        conditions.push("f.parent_id IS NULL");
      } else {
        conditions.push(`parent.path = $${paramCount}`);
        params.push(filters.parent_path);
        paramCount++;
      }
    }

    if (filters.folder_name) {
      conditions.push(`f.name ILIKE $${paramCount}`);
      params.push(`%${filters.folder_name}%`);
      paramCount++;
    }

    if (typeof filters.has_photos === "boolean") {
      conditions.push(
        filters.has_photos ? "f.photo_count > 0" : "f.photo_count = 0",
      );
    }

    if (filters.min_photo_count) {
      conditions.push(`f.photo_count >= $${paramCount}`);
      params.push(filters.min_photo_count);
      paramCount++;
    }

    if (filters.max_photo_count) {
      conditions.push(`f.photo_count <= $${paramCount}`);
      params.push(filters.max_photo_count);
      paramCount++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filters.limit || 100;
    const offset = filters.offset || 0;

    const queryText = `
      SELECT f.*,
             COALESCE(SUM(p.size), 0) as total_size,
             COUNT(p.id) as actual_photo_count
      FROM folders f
      LEFT JOIN folders parent ON f.parent_id = parent.id
      LEFT JOIN photos p ON p.folder_id = f.id
      ${whereClause}
      GROUP BY f.id
      ORDER BY f.name
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    params.push(limit, offset);
    const result = await query(queryText, params);
    return result.rows as Folder[];
  }

  async getFolderTree(rootPath?: string): Promise<Folder[]> {
    if (rootPath === undefined || rootPath === "") {
      return getFolders();
    } else {
      return getFolders(rootPath);
    }
  }

  async getFavoritePhotos(limit: number = 100): Promise<Photo[]> {
    const result = await query(
      `
      SELECT p.*, f.path as folder_path, f.name as folder_name
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.is_favorite = true
      ORDER BY p.created_at DESC
      LIMIT $1
    `,
      [limit],
    );

    return result.rows.map((photo) => ({
      ...photo,
      is_favorite: Boolean(photo.is_favorite),
      thumbnail_url: `/api/photos/${photo.id}/thumbnail`,
      metadata: photo.metadata,
    })) as Photo[];
  }

  async getRecentPhotos(limit: number = 50): Promise<Photo[]> {
    const result = await query(
      `
      SELECT p.*, f.path as folder_path, f.name as folder_name
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      ORDER BY p.modified_at DESC
      LIMIT $1
    `,
      [limit],
    );

    return result.rows.map((photo) => ({
      ...photo,
      is_favorite: Boolean(photo.is_favorite),
      thumbnail_url: `/api/photos/${photo.id}/thumbnail`,
      metadata: photo.metadata,
    })) as Photo[];
  }

  async getGalleryStats(): Promise<{
    total_photos: number;
    total_folders: number;
    total_size: number;
    favorite_photos: number;
    photos_with_metadata: number;
  }> {
    const result = await query(`
      SELECT
        (SELECT COUNT(*) FROM photos) as total_photos,
        (SELECT COUNT(*) FROM folders) as total_folders,
        (SELECT COALESCE(SUM(size), 0) FROM photos) as total_size,
        (SELECT COUNT(*) FROM photos WHERE is_favorite = true) as favorite_photos,
        (SELECT COUNT(*) FROM photos WHERE metadata IS NOT NULL) as photos_with_metadata
    `);

    return result.rows[0] as {
      total_photos: number;
      total_folders: number;
      total_size: number;
      favorite_photos: number;
      photos_with_metadata: number;
    };
  }

  async getPhotoAnalytics(options: {
    groupBy: "year" | "month" | "year-month" | "folder";
    orderBy?: "period" | "count" | "size";
    orderDirection?: "ASC" | "DESC";
    limit?: number;
  }): Promise<
    Array<{
      period: string;
      photo_count: number;
      total_size: number;
      favorite_count: number;
      folders_involved?: number;
    }>
  > {
    let selectFields: string;
    let groupByClause: string;

    switch (options.groupBy) {
      case "year":
        selectFields = `
          CASE
            WHEN f.path ~ '20[0-9][0-9]' THEN
              substring(f.path from '20[0-9][0-9]')
            ELSE 'unorganized'
          END as period`;
        groupByClause = `
          CASE
            WHEN f.path ~ '20[0-9][0-9]' THEN
              substring(f.path from '20[0-9][0-9]')
            ELSE 'unorganized'
          END`;
        break;
      case "month":
        selectFields = `to_char(modified_at, 'YYYY-MM') as period`;
        groupByClause = `to_char(modified_at, 'YYYY-MM')`;
        break;
      case "year-month":
        selectFields = `to_char(modified_at, 'YYYY-MM') as period`;
        groupByClause = `to_char(modified_at, 'YYYY-MM')`;
        break;
      case "folder":
        selectFields = `f.path as period`;
        groupByClause = `f.path`;
        break;
    }

    const orderBy = options.orderBy || "period";
    const orderDirection = options.orderDirection || "DESC";
    const limit = options.limit || 100;

    let orderByClause: string;
    switch (orderBy) {
      case "count":
        orderByClause = "photo_count";
        break;
      case "size":
        orderByClause = "total_size";
        break;
      default:
        orderByClause = "period";
    }

    const queryText =
      options.groupBy === "folder"
        ? `
      SELECT
        ${selectFields},
        COUNT(p.id) as photo_count,
        COALESCE(SUM(p.size), 0) as total_size,
        COUNT(CASE WHEN p.is_favorite = true THEN 1 END) as favorite_count
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      GROUP BY ${groupByClause}
      ORDER BY ${orderByClause} ${orderDirection}
      LIMIT $1
    `
        : `
      SELECT
        ${selectFields},
        COUNT(p.id) as photo_count,
        COALESCE(SUM(p.size), 0) as total_size,
        COUNT(CASE WHEN p.is_favorite = true THEN 1 END) as favorite_count,
        COUNT(DISTINCT p.folder_id) as folders_involved
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      ${options.groupBy === "year" ? "" : `WHERE ${groupByClause} IS NOT NULL`}
      GROUP BY ${groupByClause}
      ORDER BY ${orderByClause} ${orderDirection}
      LIMIT $1
    `;

    const result = await query(queryText, [limit]);
    return result.rows as Array<{
      period: string;
      photo_count: number;
      total_size: number;
      favorite_count: number;
      folders_involved?: number;
    }>;
  }

  async getPhotoTrends(options: {
    timeRange?: "last-30-days" | "last-year" | "all-time";
    groupBy?: "day" | "week" | "month" | "year";
    metric?: "count" | "size" | "favorites";
  }): Promise<
    Array<{
      period: string;
      value: number;
    }>
  > {
    const groupBy = options.groupBy || "month";
    const metric = options.metric || "count";
    const timeRange = options.timeRange || "last-year";

    let dateFilter = "";
    switch (timeRange) {
      case "last-30-days":
        dateFilter =
          "AND modified_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'";
        break;
      case "last-year":
        dateFilter = "AND modified_at >= CURRENT_TIMESTAMP - INTERVAL '1 year'";
        break;
      case "all-time":
        dateFilter = "";
        break;
    }

    let selectFields: string;
    let groupByClause: string;
    switch (groupBy) {
      case "day":
        selectFields = `to_char(modified_at, 'YYYY-MM-DD') as period`;
        groupByClause = `to_char(modified_at, 'YYYY-MM-DD')`;
        break;
      case "week":
        selectFields = `to_char(modified_at, 'YYYY-"W"WW') as period`;
        groupByClause = `to_char(modified_at, 'YYYY-"W"WW')`;
        break;
      case "year":
        selectFields = `to_char(modified_at, 'YYYY') as period`;
        groupByClause = `to_char(modified_at, 'YYYY')`;
        break;
      case "month":
        selectFields = `to_char(modified_at, 'YYYY-MM') as period`;
        groupByClause = `to_char(modified_at, 'YYYY-MM')`;
        break;
      default:
        selectFields = `to_char(modified_at, 'YYYY-MM') as period`;
        groupByClause = `to_char(modified_at, 'YYYY-MM')`;
        break;
    }

    let valueClause: string;
    switch (metric) {
      case "size":
        valueClause = "COALESCE(SUM(size), 0) as value";
        break;
      case "favorites":
        valueClause = "COUNT(CASE WHEN is_favorite = true THEN 1 END) as value";
        break;
      default:
        valueClause = "COUNT(*) as value";
    }

    const queryText = `
      SELECT
        ${selectFields},
        ${valueClause}
      FROM photos
      WHERE ${groupByClause} IS NOT NULL ${dateFilter}
      GROUP BY ${groupByClause}
      ORDER BY period ASC
    `;

    const result = await query(queryText);
    return result.rows as Array<{
      period: string;
      value: number;
    }>;
  }
}

const mcpHandler = new BlazeGalleryMCPHandler();

// Tool schemas
const toolSchemas = {
  search_photos: {
    inputSchema: {
      type: "object",
      properties: {
        folder_path: { type: "string", description: "Filter by folder path" },
        filename: {
          type: "string",
          description: "Filter by filename (partial match)",
        },
        mime_type: { type: "string", description: "Filter by MIME type" },
        is_favorite: {
          type: "boolean",
          description: "Filter by favorite status",
        },
        has_metadata: {
          type: "boolean",
          description: "Filter by metadata presence",
        },
        min_size: { type: "number", description: "Minimum file size in bytes" },
        max_size: { type: "number", description: "Maximum file size in bytes" },
        date_from: {
          type: "string",
          description: "Filter from date (ISO string)",
        },
        date_to: { type: "string", description: "Filter to date (ISO string)" },
        limit: { type: "number", description: "Limit results (default: 100)" },
        offset: {
          type: "number",
          description: "Offset for pagination (default: 0)",
        },
      },
    },
    outputSchema: { type: "object" },
  },
  get_photo: {
    inputSchema: {
      type: "object",
      properties: {
        photo_id: {
          type: "number",
          description: "The ID of the photo to retrieve",
        },
      },
      required: ["photo_id"],
    },
    outputSchema: { type: "object" },
  },
  search_folders: {
    inputSchema: {
      type: "object",
      properties: {
        parent_path: {
          type: "string",
          description: "Filter by parent folder path",
        },
        folder_name: {
          type: "string",
          description: "Filter by folder name (partial match)",
        },
        has_photos: {
          type: "boolean",
          description: "Filter by photo presence",
        },
        min_photo_count: { type: "number", description: "Minimum photo count" },
        max_photo_count: { type: "number", description: "Maximum photo count" },
        limit: { type: "number", description: "Limit results (default: 100)" },
        offset: {
          type: "number",
          description: "Offset for pagination (default: 0)",
        },
      },
    },
    outputSchema: { type: "object" },
  },
  get_folder: {
    inputSchema: {
      type: "object",
      properties: {
        folder_path: {
          type: "string",
          description: "The path of the folder to retrieve",
        },
      },
      required: ["folder_path"],
    },
    outputSchema: { type: "object" },
  },
  get_folder_photos: {
    inputSchema: {
      type: "object",
      properties: {
        folder_path: { type: "string", description: "The path of the folder" },
        limit: { type: "number", description: "Limit results (default: 100)" },
      },
      required: ["folder_path"],
    },
    outputSchema: { type: "object" },
  },
  get_folder_tree: {
    inputSchema: {
      type: "object",
      properties: {
        root_path: {
          type: "string",
          description: "Root path for the tree (optional)",
        },
      },
    },
    outputSchema: { type: "object" },
  },
  get_favorite_photos: {
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Limit results (default: 100)" },
      },
    },
    outputSchema: { type: "object" },
  },
  get_recent_photos: {
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Limit results (default: 50)" },
      },
    },
    outputSchema: { type: "object" },
  },
  get_gallery_stats: {
    inputSchema: {
      type: "object",
      properties: {},
    },
    outputSchema: { type: "object" },
  },
  get_photo_analytics: {
    inputSchema: {
      type: "object",
      properties: {
        groupBy: {
          type: "string",
          enum: ["year", "month", "year-month", "folder"],
          description: "Group analytics by time period or folder",
        },
        orderBy: {
          type: "string",
          enum: ["period", "count", "size"],
          description:
            "Order results by period, count, or size (default: period)",
        },
        orderDirection: {
          type: "string",
          enum: ["ASC", "DESC"],
          description: "Order direction (default: DESC)",
        },
        limit: { type: "number", description: "Limit results (default: 100)" },
      },
      required: ["groupBy"],
    },
    outputSchema: { type: "object" },
  },
  get_photo_trends: {
    inputSchema: {
      type: "object",
      properties: {
        timeRange: {
          type: "string",
          enum: ["last-30-days", "last-year", "all-time"],
          description: "Time range for trends (default: last-year)",
        },
        groupBy: {
          type: "string",
          enum: ["day", "week", "month", "year"],
          description: "Group trends by time unit (default: month)",
        },
        metric: {
          type: "string",
          enum: ["count", "size", "favorites"],
          description: "Metric to track (default: count)",
        },
      },
    },
    outputSchema: { type: "object" },
  },
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { method, params } = body;

    switch (method) {
      case "tools/list":
        return NextResponse.json({
          tools: [
            {
              name: "search_photos",
              description:
                "Search for photos in the gallery with various filters",
              inputSchema: toolSchemas.search_photos.inputSchema,
              outputSchema: toolSchemas.search_photos.outputSchema,
            },
            {
              name: "get_photo",
              description:
                "Get detailed information about a specific photo by ID",
              inputSchema: toolSchemas.get_photo.inputSchema,
              outputSchema: toolSchemas.get_photo.outputSchema,
            },
            {
              name: "search_folders",
              description:
                "Search for folders in the gallery with various filters",
              inputSchema: toolSchemas.search_folders.inputSchema,
              outputSchema: toolSchemas.search_folders.outputSchema,
            },
            {
              name: "get_folder",
              description:
                "Get detailed information about a specific folder by path",
              inputSchema: toolSchemas.get_folder.inputSchema,
              outputSchema: toolSchemas.get_folder.outputSchema,
            },
            {
              name: "get_folder_photos",
              description: "Get all photos in a specific folder",
              inputSchema: toolSchemas.get_folder_photos.inputSchema,
              outputSchema: toolSchemas.get_folder_photos.outputSchema,
            },
            {
              name: "get_folder_tree",
              description: "Get the folder hierarchy/tree structure",
              inputSchema: toolSchemas.get_folder_tree.inputSchema,
              outputSchema: toolSchemas.get_folder_tree.outputSchema,
            },
            {
              name: "get_favorite_photos",
              description: "Get all favorite photos",
              inputSchema: toolSchemas.get_favorite_photos.inputSchema,
              outputSchema: toolSchemas.get_favorite_photos.outputSchema,
            },
            {
              name: "get_recent_photos",
              description: "Get recently added/modified photos",
              inputSchema: toolSchemas.get_recent_photos.inputSchema,
              outputSchema: toolSchemas.get_recent_photos.outputSchema,
            },
            {
              name: "get_gallery_stats",
              description: "Get overall gallery statistics and metrics",
              inputSchema: toolSchemas.get_gallery_stats.inputSchema,
              outputSchema: toolSchemas.get_gallery_stats.outputSchema,
            },
            {
              name: "get_photo_analytics",
              description:
                "Get efficient analytics breakdown of photos by year, month, or folder",
              inputSchema: toolSchemas.get_photo_analytics.inputSchema,
              outputSchema: toolSchemas.get_photo_analytics.outputSchema,
            },
            {
              name: "get_photo_trends",
              description:
                "Get photo trends over time with various metrics and time ranges",
              inputSchema: toolSchemas.get_photo_trends.inputSchema,
              outputSchema: toolSchemas.get_photo_trends.outputSchema,
            },
          ],
        });

      case "tools/call":
        const { name, arguments: args } = params;

        try {
          switch (name) {
            case "search_photos": {
              const results = await mcpHandler.searchPhotos(args || {});
              return NextResponse.json({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        photos: results,
                        count: results.length,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              });
            }

            case "get_photo": {
              if (!args || typeof args.photo_id !== "number") {
                return NextResponse.json(
                  {
                    error: {
                      code: ErrorCode.InvalidRequest,
                      message: "photo_id is required and must be a number",
                    },
                  },
                  { status: 400 },
                );
              }
              const photo = await getPhoto(args.photo_id);
              if (!photo) {
                return NextResponse.json(
                  {
                    error: {
                      code: ErrorCode.InvalidRequest,
                      message: `Photo with ID ${args.photo_id} not found`,
                    },
                  },
                  { status: 404 },
                );
              }
              return NextResponse.json({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(photo, null, 2),
                  },
                ],
              });
            }

            case "search_folders": {
              const results = await mcpHandler.searchFolders(args || {});
              return NextResponse.json({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        folders: results,
                        count: results.length,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              });
            }

            case "get_folder": {
              if (!args || typeof args.folder_path !== "string") {
                return NextResponse.json(
                  {
                    error: {
                      code: ErrorCode.InvalidRequest,
                      message: "folder_path is required and must be a string",
                    },
                  },
                  { status: 400 },
                );
              }
              const folder = await getFolderByPath(args.folder_path);
              if (!folder) {
                return NextResponse.json(
                  {
                    error: {
                      code: ErrorCode.InvalidRequest,
                      message: `Folder with path "${args.folder_path}" not found`,
                    },
                  },
                  { status: 404 },
                );
              }
              return NextResponse.json({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(folder, null, 2),
                  },
                ],
              });
            }

            case "get_folder_photos": {
              if (!args || typeof args.folder_path !== "string") {
                return NextResponse.json(
                  {
                    error: {
                      code: ErrorCode.InvalidRequest,
                      message: "folder_path is required and must be a string",
                    },
                  },
                  { status: 400 },
                );
              }
              const folder = await getFolderByPath(args.folder_path);
              if (!folder) {
                return NextResponse.json(
                  {
                    error: {
                      code: ErrorCode.InvalidRequest,
                      message: `Folder with path "${args.folder_path}" not found`,
                    },
                  },
                  { status: 404 },
                );
              }
              const limit = typeof args.limit === "number" ? args.limit : 100;
              const photos = await getPhotosInFolder(folder.id);
              return NextResponse.json({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        folder_path: args.folder_path,
                        photos: photos,
                        count: photos.length,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              });
            }

            case "get_folder_tree": {
              const rootPath =
                args && typeof args.root_path === "string"
                  ? args.root_path
                  : undefined;
              const folders = await mcpHandler.getFolderTree(rootPath);
              return NextResponse.json({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        root_path: rootPath || "",
                        folders: folders,
                        count: folders.length,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              });
            }

            case "get_favorite_photos": {
              const limit =
                args && typeof args.limit === "number" ? args.limit : 100;
              const photos = await mcpHandler.getFavoritePhotos(limit);
              return NextResponse.json({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        favorite_photos: photos,
                        count: photos.length,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              });
            }

            case "get_recent_photos": {
              const limit =
                args && typeof args.limit === "number" ? args.limit : 50;
              const photos = await mcpHandler.getRecentPhotos(limit);
              return NextResponse.json({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        recent_photos: photos,
                        count: photos.length,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              });
            }

            case "get_gallery_stats": {
              const stats = await mcpHandler.getGalleryStats();
              return NextResponse.json({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(stats, null, 2),
                  },
                ],
              });
            }

            case "get_photo_analytics": {
              if (!args || typeof args.groupBy !== "string") {
                return NextResponse.json(
                  {
                    error: {
                      code: ErrorCode.InvalidRequest,
                      message: "groupBy is required and must be a string",
                    },
                  },
                  { status: 400 },
                );
              }

              const options = {
                groupBy: args.groupBy as
                  | "year"
                  | "month"
                  | "year-month"
                  | "folder",
                orderBy:
                  (args.orderBy as "period" | "count" | "size") || "period",
                orderDirection:
                  (args.orderDirection as "ASC" | "DESC") || "DESC",
                limit: typeof args.limit === "number" ? args.limit : 100,
              };

              const analytics = await mcpHandler.getPhotoAnalytics(options);
              return NextResponse.json({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        analytics,
                        groupBy: options.groupBy,
                        count: analytics.length,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              });
            }

            case "get_photo_trends": {
              const options = {
                timeRange:
                  (args &&
                    (args.timeRange as
                      | "last-30-days"
                      | "last-year"
                      | "all-time")) ||
                  "last-year",
                groupBy:
                  (args && (args.groupBy as "day" | "week" | "month")) ||
                  "month",
                metric:
                  (args && (args.metric as "count" | "size" | "favorites")) ||
                  "count",
              };

              const trends = await mcpHandler.getPhotoTrends(options);
              return NextResponse.json({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        trends,
                        timeRange: options.timeRange,
                        groupBy: options.groupBy,
                        metric: options.metric,
                        count: trends.length,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              });
            }

            default:
              return NextResponse.json(
                {
                  error: {
                    code: ErrorCode.MethodNotFound,
                    message: `Unknown tool: ${name}`,
                  },
                },
                { status: 404 },
              );
          }
        } catch (error) {
          console.error(`Error executing ${name}:`, error);
          return NextResponse.json(
            {
              error: {
                code: ErrorCode.InternalError,
                message: `Failed to execute ${name}: ${error instanceof Error ? error.message : String(error)}`,
              },
            },
            { status: 500 },
          );
        }

      default:
        return NextResponse.json(
          {
            error: {
              code: ErrorCode.MethodNotFound,
              message: `Unknown method: ${method}`,
            },
          },
          { status: 404 },
        );
    }
  } catch (error) {
    console.error("MCP API Error:", error);
    return NextResponse.json(
      {
        error: {
          code: ErrorCode.InternalError,
          message:
            error instanceof Error ? error.message : "Internal server error",
        },
      },
      { status: 500 },
    );
  }
}
