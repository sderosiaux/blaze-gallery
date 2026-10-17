import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  getFolders,
  getFolderByPath,
  getPhotosInFolder,
  getPhoto,
  query,
  requireRow,
} from "@/lib/database";
import type { Photo, Folder } from "@/types";
import { QueryBuilder } from "@/lib/queryBuilder";
import type { JsonObject } from "@/app/api/_lib/request";
import {
  isJsonObject,
  optionalBoolean,
  optionalNumber,
  optionalString,
} from "@/app/api/_lib/request";
import type { PhotoWithFolderRow } from "@/app/api/_lib/db";
import { withThumbnailUrl } from "@/app/api/_lib/db";

// pg delivers COUNT and SUM (bigint, numeric) as strings; the tools return them as such
type PgBigint = string;

// The folder columns plus the two aggregates of the search query
type FolderSearchRow = Omit<Folder, "total_size"> & {
  total_size: PgBigint;
  actual_photo_count: PgBigint;
};

interface GalleryStats {
  total_photos: PgBigint;
  total_folders: PgBigint;
  total_size: PgBigint;
  favorite_photos: PgBigint;
  photos_with_metadata: PgBigint;
}

type AnalyticsGroupBy = "year" | "month" | "year-month" | "folder";
type AnalyticsOrderBy = "period" | "count" | "size";
type AnalyticsOrderDirection = "ASC" | "DESC";

interface AnalyticsRow {
  period: string;
  photo_count: PgBigint;
  total_size: PgBigint;
  favorite_count: PgBigint;
  folders_involved?: PgBigint;
}

type TrendTimeRange = "last-30-days" | "last-year" | "all-time";
type TrendGroupBy = "day" | "week" | "month" | "year";
type TrendMetric = "count" | "size" | "favorites";

interface TrendRow {
  period: string;
  value: PgBigint;
}

interface GroupConfig {
  selectFields: string;
  groupByClause: string;
}

/** A tool argument error: reported to the client as a JSON-RPC error with its own code and HTTP status. */
class McpToolError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** The allowed option that equals `value`, else the fallback. */
function pickOption<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.find((option) => option === value) ?? fallback;
}

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
      filters.limit ? filters.limit : 100,
      filters.offset ?? 0,
    );

    const queryText = `
      SELECT p.*, f.path as folder_path, f.name as folder_name
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      ${qb.getWhereClause()}
      ORDER BY p.modified_at DESC, p.filename
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const result = await query<PhotoWithFolderRow>(queryText, qb.getParams());

    return result.rows.map(withThumbnailUrl);
  }

  async searchFolders(
    filters: FolderSearchFilters,
  ): Promise<FolderSearchRow[]> {
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
      filters.limit ? filters.limit : 100,
      filters.offset ?? 0,
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

    const result = await query<FolderSearchRow>(queryText, qb.getParams());
    return result.rows;
  }

  async getFolderTree(rootPath?: string): Promise<Folder[]> {
    if (rootPath === undefined || rootPath === "") {
      return getFolders();
    } else {
      return getFolders(rootPath);
    }
  }

  async getFavoritePhotos(limit = 100): Promise<Photo[]> {
    const result = await query<PhotoWithFolderRow>(
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

    return result.rows.map(withThumbnailUrl);
  }

  async getRecentPhotos(limit = 50): Promise<Photo[]> {
    const result = await query<PhotoWithFolderRow>(
      `
      SELECT p.*, f.path as folder_path, f.name as folder_name
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      ORDER BY p.modified_at DESC
      LIMIT $1
    `,
      [limit],
    );

    return result.rows.map(withThumbnailUrl);
  }

  async getGalleryStats(): Promise<GalleryStats> {
    const result = await query<GalleryStats>(`
      SELECT
        (SELECT COUNT(*) FROM photos) as total_photos,
        (SELECT COUNT(*) FROM folders) as total_folders,
        (SELECT COALESCE(SUM(size), 0) FROM photos) as total_size,
        (SELECT COUNT(*) FROM photos WHERE is_favorite = true) as favorite_photos,
        (SELECT COUNT(*) FROM photos WHERE metadata IS NOT NULL) as photos_with_metadata
    `);

    return requireRow(result, "Gallery stats");
  }

  async getPhotoAnalytics(options: {
    groupBy: AnalyticsGroupBy;
    orderBy?: AnalyticsOrderBy;
    orderDirection?: AnalyticsOrderDirection;
    limit?: number;
  }): Promise<AnalyticsRow[]> {
    const { selectFields, groupByClause } = this.getAnalyticsGroupConfig(
      options.groupBy,
    );
    const orderByClause = this.getAnalyticsOrderColumn(
      options.orderBy ?? "period",
    );
    const orderDirection = options.orderDirection ?? "DESC";
    const limit = options.limit ? options.limit : 100;

    const queryText = this.buildAnalyticsQuery(
      options.groupBy,
      selectFields,
      groupByClause,
      orderByClause,
      orderDirection,
    );

    const result = await query<AnalyticsRow>(queryText, [limit]);
    return result.rows;
  }

  private getAnalyticsGroupConfig(groupBy: AnalyticsGroupBy): GroupConfig {
    const yearCase = `CASE WHEN f.path ~ '20[0-9][0-9]' THEN substring(f.path from '20[0-9][0-9]') ELSE 'unorganized' END`;

    const month: GroupConfig = {
      selectFields: `to_char(modified_at, 'YYYY-MM') as period`,
      groupByClause: `to_char(modified_at, 'YYYY-MM')`,
    };
    const configs: Record<AnalyticsGroupBy, GroupConfig> = {
      year: { selectFields: `${yearCase} as period`, groupByClause: yearCase },
      month,
      "year-month": month,
      folder: { selectFields: `f.path as period`, groupByClause: `f.path` },
    };

    return configs[groupBy];
  }

  private getAnalyticsOrderColumn(orderBy: AnalyticsOrderBy): string {
    const columns: Record<AnalyticsOrderBy, string> = {
      count: "photo_count",
      size: "total_size",
      period: "period",
    };
    return columns[orderBy];
  }

  private buildAnalyticsQuery(
    groupBy: AnalyticsGroupBy,
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
    timeRange?: TrendTimeRange;
    groupBy?: TrendGroupBy;
    metric?: TrendMetric;
  }): Promise<TrendRow[]> {
    const groupBy = options.groupBy ?? "month";
    const metric = options.metric ?? "count";
    const timeRange = options.timeRange ?? "last-year";

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

    const result = await query<TrendRow>(queryText);
    return result.rows;
  }
}

const mcpHandler = new BlazeGalleryMCPHandler();

type ToolArgs = JsonObject;
type ToolHandler = (args: ToolArgs) => Promise<unknown>;

function parseSearchFilters(args: ToolArgs): SearchFilters {
  return {
    folder_path: optionalString(args.folder_path),
    filename: optionalString(args.filename),
    mime_type: optionalString(args.mime_type),
    is_favorite: optionalBoolean(args.is_favorite),
    has_metadata: optionalBoolean(args.has_metadata),
    min_size: optionalNumber(args.min_size),
    max_size: optionalNumber(args.max_size),
    date_from: optionalString(args.date_from),
    date_to: optionalString(args.date_to),
    limit: optionalNumber(args.limit),
    offset: optionalNumber(args.offset),
  };
}

function parseFolderSearchFilters(args: ToolArgs): FolderSearchFilters {
  return {
    parent_path: optionalString(args.parent_path),
    folder_name: optionalString(args.folder_name),
    has_photos: optionalBoolean(args.has_photos),
    min_photo_count: optionalNumber(args.min_photo_count),
    max_photo_count: optionalNumber(args.max_photo_count),
    limit: optionalNumber(args.limit),
    offset: optionalNumber(args.offset),
  };
}

function requireFolderPath(args: ToolArgs): string {
  const folderPath = optionalString(args.folder_path);
  if (folderPath === undefined) {
    throw new McpToolError(
      ErrorCode.InvalidRequest,
      "folder_path is required and must be a string",
    );
  }
  return folderPath;
}

// Tool dispatch map - replaces switch statement
const toolHandlers = new Map<string, ToolHandler>([
  [
    "search_photos",
    async (args) => {
      const results = await mcpHandler.searchPhotos(parseSearchFilters(args));
      return { photos: results, count: results.length };
    },
  ],

  [
    "get_photo",
    async (args) => {
      const photoId = optionalNumber(args.photo_id);
      if (photoId === undefined) {
        throw new McpToolError(
          ErrorCode.InvalidRequest,
          "photo_id is required and must be a number",
        );
      }
      const photo = await getPhoto(photoId);
      if (!photo) {
        throw new McpToolError(
          ErrorCode.InvalidRequest,
          `Photo with ID ${photoId} not found`,
          404,
        );
      }
      return photo;
    },
  ],

  [
    "search_folders",
    async (args) => {
      const results = await mcpHandler.searchFolders(
        parseFolderSearchFilters(args),
      );
      return { folders: results, count: results.length };
    },
  ],

  [
    "get_folder",
    async (args) => {
      const folderPath = requireFolderPath(args);
      const folder = await getFolderByPath(folderPath);
      if (!folder) {
        throw new McpToolError(
          ErrorCode.InvalidRequest,
          `Folder with path "${folderPath}" not found`,
          404,
        );
      }
      return folder;
    },
  ],

  [
    "get_folder_photos",
    async (args) => {
      const folderPath = requireFolderPath(args);
      const folder = await getFolderByPath(folderPath);
      if (!folder) {
        throw new McpToolError(
          ErrorCode.InvalidRequest,
          `Folder with path "${folderPath}" not found`,
          404,
        );
      }
      const photos = await getPhotosInFolder(folder.id);
      return { folder_path: folderPath, photos, count: photos.length };
    },
  ],

  [
    "get_folder_tree",
    async (args) => {
      const rootPath = optionalString(args.root_path);
      const folders = await mcpHandler.getFolderTree(rootPath);
      return { root_path: rootPath ?? "", folders, count: folders.length };
    },
  ],

  [
    "get_favorite_photos",
    async (args) => {
      const photos = await mcpHandler.getFavoritePhotos(
        optionalNumber(args.limit) ?? 100,
      );
      return { favorite_photos: photos, count: photos.length };
    },
  ],

  [
    "get_recent_photos",
    async (args) => {
      const photos = await mcpHandler.getRecentPhotos(
        optionalNumber(args.limit) ?? 50,
      );
      return { recent_photos: photos, count: photos.length };
    },
  ],

  ["get_gallery_stats", () => mcpHandler.getGalleryStats()],

  [
    "get_photo_analytics",
    async (args) => {
      if (typeof args.groupBy !== "string") {
        throw new McpToolError(
          ErrorCode.InvalidRequest,
          "groupBy is required and must be a string",
        );
      }
      // Unknown values fall back to the default, like the SQL builders did
      const options = {
        groupBy: pickOption<AnalyticsGroupBy>(
          args.groupBy,
          ["year", "month", "year-month", "folder"],
          "month",
        ),
        orderBy: pickOption<AnalyticsOrderBy>(
          args.orderBy,
          ["period", "count", "size"],
          "period",
        ),
        orderDirection: pickOption<AnalyticsOrderDirection>(
          args.orderDirection,
          ["ASC", "DESC"],
          "DESC",
        ),
        limit: optionalNumber(args.limit) ?? 100,
      };
      const analytics = await mcpHandler.getPhotoAnalytics(options);
      return { analytics, groupBy: options.groupBy, count: analytics.length };
    },
  ],

  [
    "get_photo_trends",
    async (args) => {
      const options = {
        timeRange: pickOption<TrendTimeRange>(
          args.timeRange,
          ["last-30-days", "last-year", "all-time"],
          "last-year",
        ),
        groupBy: pickOption<TrendGroupBy>(
          args.groupBy,
          ["day", "week", "month", "year"],
          "month",
        ),
        metric: pickOption<TrendMetric>(
          args.metric,
          ["count", "size", "favorites"],
          "count",
        ),
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
  ],
]);

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
    const body: unknown = await request.json();
    if (!isJsonObject(body)) {
      throw new Error("Request body must be a JSON object");
    }
    const { jsonrpc, id, method } = body;
    const params = isJsonObject(body.params) ? body.params : {};

    // Helper to format JSON-RPC response
    const jsonRpcResponse = (result: unknown) => {
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
        const name = optionalString(params.name);
        const args = isJsonObject(params.arguments) ? params.arguments : {};
        const handler = name === undefined ? undefined : toolHandlers.get(name);

        if (!handler) {
          return jsonRpcError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${String(name)}`,
            404,
          );
        }

        try {
          const result = await handler(args);
          return jsonRpcResponse({
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          });
        } catch (error) {
          // Handle validation errors thrown from handlers
          if (error instanceof McpToolError) {
            return jsonRpcError(error.code, error.message, error.status);
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
          `Unknown method: ${String(method)}`,
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
