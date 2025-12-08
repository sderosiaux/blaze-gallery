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
import { QueryBuilder } from "@/lib/queryBuilder";

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
    const qb = new QueryBuilder();

    // Build WHERE conditions using QueryBuilder
    qb.pathMatch("f.path", filters.folder_path)
      .ilike("p.filename", filters.filename)
      .equals("p.mime_type", filters.mime_type)
      .boolean("p.is_favorite", filters.is_favorite)
      .hasValue("p.metadata", filters.has_metadata)
      .gte("p.size", filters.min_size)
      .lte("p.size", filters.max_size)
      .gte("p.modified_at", filters.date_from)
      .lte("p.modified_at", filters.date_to);

    const { limitParam, offsetParam } = qb.pagination(
      filters.limit || 100,
      filters.offset || 0,
    );

    const queryText = `
      SELECT p.*, f.path as folder_path, f.name as folder_name
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      ${qb.getWhereClause()}
      ORDER BY p.modified_at DESC, p.filename
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const result = await query(queryText, qb.getParams());

    return result.rows.map((photo) => ({
      ...photo,
      is_favorite: Boolean(photo.is_favorite),
      thumbnail_url: `/api/photos/${photo.id}/thumbnail`,
      metadata: photo.metadata,
    })) as Photo[];
  }

  async searchFolders(filters: FolderSearchFilters): Promise<Folder[]> {
    const qb = new QueryBuilder();

    // Handle parent_path filter (special case: empty string means root)
    if (filters.parent_path !== undefined) {
      if (filters.parent_path === "") {
        qb.custom("f.parent_id IS NULL");
      } else {
        qb.equals("parent.path", filters.parent_path);
      }
    }

    qb.ilike("f.name", filters.folder_name);

    // Handle has_photos filter (different conditions based on value)
    if (typeof filters.has_photos === "boolean") {
      qb.custom(filters.has_photos ? "f.photo_count > 0" : "f.photo_count = 0");
    }

    qb.gte("f.photo_count", filters.min_photo_count).lte(
      "f.photo_count",
      filters.max_photo_count,
    );

    const { limitParam, offsetParam } = qb.pagination(
      filters.limit || 100,
      filters.offset || 0,
    );

    const queryText = `
      SELECT f.*,
             COALESCE(SUM(p.size), 0) as total_size,
             COUNT(p.id) as actual_photo_count
      FROM folders f
      LEFT JOIN folders parent ON f.parent_id = parent.id
      LEFT JOIN photos p ON p.folder_id = f.id
      ${qb.getWhereClause()}
      GROUP BY f.id
      ORDER BY f.name
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const result = await query(queryText, qb.getParams());
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
    const { selectFields, groupByClause } = this.getAnalyticsGroupConfig(
      options.groupBy,
    );
    const orderByClause = this.getAnalyticsOrderColumn(
      options.orderBy || "period",
    );
    const orderDirection = options.orderDirection || "DESC";
    const limit = options.limit || 100;

    const queryText = this.buildAnalyticsQuery(
      options.groupBy,
      selectFields,
      groupByClause,
      orderByClause,
      orderDirection,
    );

    const result = await query(queryText, [limit]);
    return result.rows as Array<{
      period: string;
      photo_count: number;
      total_size: number;
      favorite_count: number;
      folders_involved?: number;
    }>;
  }

  private getAnalyticsGroupConfig(groupBy: string): {
    selectFields: string;
    groupByClause: string;
  } {
    const yearCase = `CASE WHEN f.path ~ '20[0-9][0-9]' THEN substring(f.path from '20[0-9][0-9]') ELSE 'unorganized' END`;

    const configs: Record<
      string,
      { selectFields: string; groupByClause: string }
    > = {
      year: { selectFields: `${yearCase} as period`, groupByClause: yearCase },
      month: {
        selectFields: `to_char(modified_at, 'YYYY-MM') as period`,
        groupByClause: `to_char(modified_at, 'YYYY-MM')`,
      },
      "year-month": {
        selectFields: `to_char(modified_at, 'YYYY-MM') as period`,
        groupByClause: `to_char(modified_at, 'YYYY-MM')`,
      },
      folder: { selectFields: `f.path as period`, groupByClause: `f.path` },
    };

    return configs[groupBy] || configs.month;
  }

  private getAnalyticsOrderColumn(orderBy: string): string {
    const columns: Record<string, string> = {
      count: "photo_count",
      size: "total_size",
      period: "period",
    };
    return columns[orderBy] || "period";
  }

  private buildAnalyticsQuery(
    groupBy: string,
    selectFields: string,
    groupByClause: string,
    orderByClause: string,
    orderDirection: string,
  ): string {
    const baseSelect = `
      SELECT
        ${selectFields},
        COUNT(p.id) as photo_count,
        COALESCE(SUM(p.size), 0) as total_size,
        COUNT(CASE WHEN p.is_favorite = true THEN 1 END) as favorite_count`;

    const foldersInvolved =
      groupBy !== "folder"
        ? `,\n        COUNT(DISTINCT p.folder_id) as folders_involved`
        : "";
    const whereClause =
      groupBy !== "year" && groupBy !== "folder"
        ? `WHERE ${groupByClause} IS NOT NULL`
        : "";

    return `
      ${baseSelect}${foldersInvolved}
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      ${whereClause}
      GROUP BY ${groupByClause}
      ORDER BY ${orderByClause} ${orderDirection}
      LIMIT $1
    `;
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

// Tool handler type
type ToolHandler = (args: any) => Promise<any>;

// Tool dispatch map - replaces switch statement
const toolHandlers: Record<string, ToolHandler> = {
  search_photos: async (args) => {
    const results = await mcpHandler.searchPhotos(args || {});
    return { photos: results, count: results.length };
  },

  get_photo: async (args) => {
    if (!args || typeof args.photo_id !== "number") {
      throw {
        code: ErrorCode.InvalidRequest,
        message: "photo_id is required and must be a number",
      };
    }
    const photo = await getPhoto(args.photo_id);
    if (!photo) {
      throw {
        code: ErrorCode.InvalidRequest,
        message: `Photo with ID ${args.photo_id} not found`,
        status: 404,
      };
    }
    return photo;
  },

  search_folders: async (args) => {
    const results = await mcpHandler.searchFolders(args || {});
    return { folders: results, count: results.length };
  },

  get_folder: async (args) => {
    if (!args || typeof args.folder_path !== "string") {
      throw {
        code: ErrorCode.InvalidRequest,
        message: "folder_path is required and must be a string",
      };
    }
    const folder = await getFolderByPath(args.folder_path);
    if (!folder) {
      throw {
        code: ErrorCode.InvalidRequest,
        message: `Folder with path "${args.folder_path}" not found`,
        status: 404,
      };
    }
    return folder;
  },

  get_folder_photos: async (args) => {
    if (!args || typeof args.folder_path !== "string") {
      throw {
        code: ErrorCode.InvalidRequest,
        message: "folder_path is required and must be a string",
      };
    }
    const folder = await getFolderByPath(args.folder_path);
    if (!folder) {
      throw {
        code: ErrorCode.InvalidRequest,
        message: `Folder with path "${args.folder_path}" not found`,
        status: 404,
      };
    }
    const photos = await getPhotosInFolder(folder.id);
    return { folder_path: args.folder_path, photos, count: photos.length };
  },

  get_folder_tree: async (args) => {
    const rootPath =
      args && typeof args.root_path === "string" ? args.root_path : undefined;
    const folders = await mcpHandler.getFolderTree(rootPath);
    return { root_path: rootPath || "", folders, count: folders.length };
  },

  get_favorite_photos: async (args) => {
    const limit = args && typeof args.limit === "number" ? args.limit : 100;
    const photos = await mcpHandler.getFavoritePhotos(limit);
    return { favorite_photos: photos, count: photos.length };
  },

  get_recent_photos: async (args) => {
    const limit = args && typeof args.limit === "number" ? args.limit : 50;
    const photos = await mcpHandler.getRecentPhotos(limit);
    return { recent_photos: photos, count: photos.length };
  },

  get_gallery_stats: async () => {
    return mcpHandler.getGalleryStats();
  },

  get_photo_analytics: async (args) => {
    if (!args || typeof args.groupBy !== "string") {
      throw {
        code: ErrorCode.InvalidRequest,
        message: "groupBy is required and must be a string",
      };
    }
    const options = {
      groupBy: args.groupBy as "year" | "month" | "year-month" | "folder",
      orderBy: (args.orderBy as "period" | "count" | "size") || "period",
      orderDirection: (args.orderDirection as "ASC" | "DESC") || "DESC",
      limit: typeof args.limit === "number" ? args.limit : 100,
    };
    const analytics = await mcpHandler.getPhotoAnalytics(options);
    return { analytics, groupBy: options.groupBy, count: analytics.length };
  },

  get_photo_trends: async (args) => {
    const options = {
      timeRange:
        (args?.timeRange as "last-30-days" | "last-year" | "all-time") ||
        "last-year",
      groupBy: (args?.groupBy as "day" | "week" | "month") || "month",
      metric: (args?.metric as "count" | "size" | "favorites") || "count",
    };
    const trends = await mcpHandler.getPhotoTrends(options);
    return {
      trends,
      timeRange: options.timeRange,
      groupBy: options.groupBy,
      metric: options.metric,
      count: trends.length,
    };
  },
};

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

// MCP server capabilities and info
const SERVER_INFO = {
  name: "blaze-gallery",
  version: "1.0.0",
};

const SERVER_CAPABILITIES = {
  tools: {},
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jsonrpc, id, method, params } = body;

    // Helper to format JSON-RPC response
    const jsonRpcResponse = (result: any) => {
      if (jsonrpc === "2.0") {
        return NextResponse.json({ jsonrpc: "2.0", id, result });
      }
      return NextResponse.json(result);
    };

    const jsonRpcError = (code: number, message: string, status = 400) => {
      if (jsonrpc === "2.0") {
        return NextResponse.json(
          { jsonrpc: "2.0", id, error: { code, message } },
          { status },
        );
      }
      return NextResponse.json({ error: { code, message } }, { status });
    };

    switch (method) {
      // MCP Protocol methods
      case "initialize":
        return jsonRpcResponse({
          protocolVersion: "2024-11-05",
          capabilities: SERVER_CAPABILITIES,
          serverInfo: SERVER_INFO,
        });

      case "notifications/initialized":
        // Client notification that initialization is complete
        return jsonRpcResponse({});

      case "ping":
        return jsonRpcResponse({});

      case "tools/list":
        return jsonRpcResponse({
          tools: [
            {
              name: "search_photos",
              description:
                "Search for photos in the gallery with various filters",
              inputSchema: toolSchemas.search_photos.inputSchema,
            },
            {
              name: "get_photo",
              description:
                "Get detailed information about a specific photo by ID",
              inputSchema: toolSchemas.get_photo.inputSchema,
            },
            {
              name: "search_folders",
              description:
                "Search for folders in the gallery with various filters",
              inputSchema: toolSchemas.search_folders.inputSchema,
            },
            {
              name: "get_folder",
              description:
                "Get detailed information about a specific folder by path",
              inputSchema: toolSchemas.get_folder.inputSchema,
            },
            {
              name: "get_folder_photos",
              description: "Get all photos in a specific folder",
              inputSchema: toolSchemas.get_folder_photos.inputSchema,
            },
            {
              name: "get_folder_tree",
              description: "Get the folder hierarchy/tree structure",
              inputSchema: toolSchemas.get_folder_tree.inputSchema,
            },
            {
              name: "get_favorite_photos",
              description: "Get all favorite photos",
              inputSchema: toolSchemas.get_favorite_photos.inputSchema,
            },
            {
              name: "get_recent_photos",
              description: "Get recently added/modified photos",
              inputSchema: toolSchemas.get_recent_photos.inputSchema,
            },
            {
              name: "get_gallery_stats",
              description: "Get overall gallery statistics and metrics",
              inputSchema: toolSchemas.get_gallery_stats.inputSchema,
            },
            {
              name: "get_photo_analytics",
              description:
                "Get efficient analytics breakdown of photos by year, month, or folder",
              inputSchema: toolSchemas.get_photo_analytics.inputSchema,
            },
            {
              name: "get_photo_trends",
              description:
                "Get photo trends over time with various metrics and time ranges",
              inputSchema: toolSchemas.get_photo_trends.inputSchema,
            },
          ],
        });

      case "tools/call": {
        const { name, arguments: args } = params;
        const handler = toolHandlers[name];

        if (!handler) {
          return jsonRpcError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${name}`,
            404,
          );
        }

        try {
          const result = await handler(args);
          return jsonRpcResponse({
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          });
        } catch (error: any) {
          // Handle validation errors thrown from handlers
          if (error.code && error.message) {
            return jsonRpcError(error.code, error.message, error.status || 400);
          }
          console.error(`Error executing ${name}:`, error);
          return jsonRpcError(
            ErrorCode.InternalError,
            `Failed to execute ${name}: ${error instanceof Error ? error.message : String(error)}`,
            500,
          );
        }
      }

      default:
        return jsonRpcError(
          ErrorCode.MethodNotFound,
          `Unknown method: ${method}`,
          404,
        );
    }
  } catch (error) {
    console.error("MCP API Error:", error);
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
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
