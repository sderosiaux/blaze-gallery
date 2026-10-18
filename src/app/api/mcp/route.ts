import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  getFolders,
  getFolderByPath,
  getPhotoColors,
  getPhotosByColor,
  getPhotosInFolder,
  getPhoto,
  NO_PHOTO_FILTER,
  query,
  requireRow,
} from "@/lib/database";
import {
  COLOR_TONES,
  formatRankCursor,
  HOLDS,
  HUES,
  isColorTone,
  isHue,
  parseRankCursor,
  TONE_LIMITS,
  tonesOf,
} from "@/lib/colors";
import { parsePeriod } from "@/lib/mapArea";
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
import { requireAuthOrApiKey } from "@/lib/auth/middleware";
import { PeopleError } from "@/lib/people";
import { mcpListPeople, mcpPersonPhotos, mcpPhotoFaces } from "@/lib/peopleMcp";
import { semanticSearch } from "@/lib/semanticSearch";
import { parseDateRange, periodFilter, rangeFilter } from "@/lib/semanticQuery";
import {
  decodeCursor,
  encodeCursor,
  toOffsetCursor,
} from "@/app/api/_lib/cursor";

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

const COLOR_LIMIT = { default: 50, max: 200 };

/** search_photos_by_color's arguments, checked: a wrong value is an error, not a silent default. */
function parseColorSearch(args: ToolArgs) {
  const fail = (message: string) =>
    new McpToolError(ErrorCode.InvalidRequest, message);
  const optional = <T>(
    value: unknown,
    is: (v: unknown) => v is T,
    message: string,
  ): T | null => {
    if (value === undefined || value === null) return null;
    if (!is(value)) throw fail(message);
    return value;
  };
  const color = optional(
    args.color,
    isHue,
    `color must be one of ${HUES.join(", ")}`,
  );
  const tone = optional(
    args.tone,
    isColorTone,
    `tone must be one of ${COLOR_TONES.join(", ")}`,
  );
  if (color === null && tone === null)
    throw fail("give a color, a tone or both");
  const period = parsePeriod((key) => {
    const value = args[key];
    return typeof value === "string" ? value : null;
  });
  if (!period.ok) throw fail(period.error);
  const limit = args.limit ?? COLOR_LIMIT.default;
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > COLOR_LIMIT.max
  )
    throw fail(`limit must be an integer in 1..${COLOR_LIMIT.max}`);
  const cursor =
    typeof args.cursor === "string" ? parseRankCursor(args.cursor) : null;
  if (args.cursor !== undefined && args.cursor !== null && !cursor)
    throw fail("cursor must be a next_cursor from this tool");
  return { colors: { color, tone }, period: period.value, limit, cursor };
}

const DAY_OR_INSTANT =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z)?$/;
const MAX_PERSON_PHOTOS = 200;

function optionalDate(args: ToolArgs, name: string): string | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !DAY_OR_INSTANT.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new McpToolError(
      ErrorCode.InvalidParams,
      `${name} must be a day (YYYY-MM-DD) or an ISO instant ending in Z`,
    );
  }
  return value;
}

function requirePositiveInt(args: ToolArgs, name: string): number {
  const value = args[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new McpToolError(
      ErrorCode.InvalidParams,
      `${name} is required and must be a positive integer`,
    );
  }
  return value;
}

/** People errors carry an HTTP status: 404 for an unknown person or photo. */
async function peopleCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PeopleError) {
      throw new McpToolError(
        error.status === 404
          ? ErrorCode.InvalidRequest
          : ErrorCode.InvalidParams,
        error.message,
        error.status,
      );
    }
    throw error;
  }
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

  [
    "search_photos_by_color",
    async (args) => {
      const { colors, period, limit, cursor } = parseColorSearch(args);
      const { photos, next } = await getPhotosByColor(
        { ...NO_PHOTO_FILTER, colors, dates: periodFilter(period) },
        cursor,
        limit,
      );
      return {
        photos,
        count: photos.length,
        next_cursor: next ? formatRankCursor(next) : null,
      };
    },
  ],

  [
    "get_photo_colors",
    async (args) => {
      const photoId = optionalNumber(args.photo_id);
      if (photoId === undefined || !Number.isSafeInteger(photoId)) {
        throw new McpToolError(
          ErrorCode.InvalidRequest,
          "photo_id is required and must be an integer",
        );
      }
      const [photo, colors] = await Promise.all([
        getPhoto(photoId),
        getPhotoColors(photoId),
      ]);
      if (!photo) {
        throw new McpToolError(
          ErrorCode.InvalidRequest,
          `Photo with ID ${photoId} not found`,
          404,
        );
      }
      if (!colors) return { photo_id: photoId, measured: false };
      const hues = Object.fromEntries(
        HUES.map((hue, i) => [hue, colors.hues[i] ?? 0]),
      );
      return {
        photo_id: photoId,
        measured: true,
        hues,
        colors: HUES.filter((hue) => (hues[hue] ?? 0) >= HOLDS).sort(
          (a, b) => (hues[b] ?? 0) - (hues[a] ?? 0),
        ),
        tones: tonesOf(colors),
        palette: colors.palette,
        colorfulness: colors.colorfulness,
        chroma: colors.chroma,
        luminance: colors.luminance,
        monochrome: colors.monochrome,
        model: colors.model,
      };
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

  ["list_people", () => mcpListPeople()],

  [
    "get_person_photos",
    async (args) => {
      const person = args.person;
      if (
        !(typeof person === "string" && person.trim()) &&
        !(typeof person === "number" && Number.isSafeInteger(person))
      ) {
        throw new McpToolError(
          ErrorCode.InvalidParams,
          "person is required: a person_id (number) or an exact name (string)",
        );
      }
      const limit =
        args.limit === undefined ? 50 : requirePositiveInt(args, "limit");
      const cursor = args.cursor;
      if (cursor !== undefined && typeof cursor !== "string") {
        throw new McpToolError(
          ErrorCode.InvalidParams,
          "cursor must be a string",
        );
      }
      return peopleCall(() =>
        mcpPersonPhotos({
          person,
          from: optionalDate(args, "from"),
          to: optionalDate(args, "to"),
          limit: Math.min(limit, MAX_PERSON_PHOTOS),
          cursor,
        }),
      );
    },
  ],

  [
    "get_photo_faces",
    async (args) => {
      const photoId = requirePositiveInt(args, "photo_id");
      return peopleCall(() => mcpPhotoFaces(photoId));
    },
  ],

  [
    "semantic_search",
    async (args) => {
      const query = optionalString(args.query)?.trim();
      if (!query) {
        throw new McpToolError(
          ErrorCode.InvalidRequest,
          "query is required and must be a non-empty string",
        );
      }
      const limit = optionalNumber(args.limit) ?? 30;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new McpToolError(
          ErrorCode.InvalidRequest,
          "limit must be an integer from 1 to 100",
        );
      }
      const cursorArg = optionalString(args.cursor);
      const cursor =
        cursorArg === undefined
          ? null
          : decodeCursor(cursorArg, toOffsetCursor);
      if (cursorArg !== undefined && !cursor) {
        throw new McpToolError(
          ErrorCode.InvalidRequest,
          "cursor must be a next_cursor returned by semantic_search",
        );
      }
      const range = parseDateRange(
        optionalString(args.from),
        optionalString(args.to),
      );
      if (!range.ok) {
        throw new McpToolError(ErrorCode.InvalidRequest, range.error);
      }
      const result = await semanticSearch(query, {
        filter: { ...NO_PHOTO_FILTER, dates: rangeFilter(range.value) },
        cut: true,
        offset: cursor?.offset ?? 0,
        limit,
        count: true,
      });
      return {
        status: result.status,
        indexed_photos: result.indexed,
        photos: result.photos.map((photo) => ({
          id: Number(photo.id),
          filename: photo.filename,
          folder_path: photo.folder_path,
          date_taken: photo.metadata?.date_taken ?? null,
          score: photo.score,
          is_favorite: photo.is_favorite,
          thumbnail_url: photo.thumbnail_url,
        })),
        count: result.photos.length,
        next_cursor:
          result.next === null ? null : encodeCursor({ offset: result.next }),
      };
    },
  ],
]);

// -- people tools: field documentation (what a client agent reads) ----------

const FACE_FIELDS = `face fields:
- face_id: stable id of this face; crop_url: GET a 256 px square JPEG of the face, upright, with some room around it.
- box: [x, y, width, height] as fractions (0-1) of the photo AS SHOWN (EXIF orientation and the owner's hand rotation applied), origin top-left. Multiply by the shown width/height to get pixels.
- width_px, height_px: size of the face in pixels of the original file, as shown. Rough quality guide: < 60 small, 60-150 medium, > 150 large.
- det_score: detector confidence 0-1 (stored faces are >= 0.7).
- sharpness: variance of the Laplacian of the aligned 112 px face crop; higher is sharper (< 50 blurry, > 150 crisp).
- yaw, pitch, roll: head pose in degrees, 0 = facing the camera; |yaw| > 45 is a profile.
- eye_left_open, eye_right_open: lid gap / eye width, left/right as seen in the photo (~0.3 open, < 0.15 closed). mouth_open: inner-lip gap / mouth width (~0 closed, > 0.3 wide open).
- expression: strongest of expression_scores, probabilities of anger, contempt, disgust, fear, happiness, neutral, sadness, surprise (sum ~1).
- cluster_eligible: true when the face is good enough to define a person (det >= 0.8, >= 112 px, sharp, |yaw| <= 45).
- upright_turn: clockwise degrees that stand the face up on the photo as shown (0 almost always).
Null numbers mean "not measured".`;

const PHOTO_FIELDS = `photo fields:
- photo_id, filename, folder_path (folder in the owner's bucket; its name often says the event).
- taken: ISO instant the photo was taken; date_source says where it comes from: "exif" (camera clock), or "folder" (the folder name's date, used when there is no EXIF date or the camera clock disagrees with it by more than 6 months, e.g. a camera never set). null when unknown. exif_date_taken: the raw EXIF value. EXIF times are wall-clock times serialized with a Z suffix: read them as local time, not UTC.
- gps: {latitude, longitude} or null.
- width, height: pixel size as shown (hand rotation applied); user_rotation: clockwise degrees the owner turned the photo by hand.
- description: what the image shows, written by a vision-language model from the pixels alone, or null when the photo was not described yet: caption (one French sentence, no names), activity (short French phrase), setting (indoor | outdoor | vehicle | unknown), place_type (home | garden | restaurant | beach | mountain | city | school | party_venue | car | nature | other), occasion (christmas | birthday | wedding | holiday | everyday | party | school_event | sport | other | unknown), people_count, framing (close_up | portrait | half_body | full_body | group | landscape | object), objects (French nouns), mood (joyful | calm | tender | funny | tired | sad | focused | festive | neutral), model. occasion is guessed from what is visible (candles, a tree, a dress), never from the date: cross it with taken and the folder name (folders often say "Anniversaire", "Noël", "Mariage") before trusting it.
- urls.thumbnail (400 px wide), urls.display (2048 px long side, the best web rendition): paths on the Blaze server, fetched with the same credentials as this endpoint (session cookie, or Authorization: Bearer <API_KEY>). The first request of a display rendition may take a few seconds (made from the original, then stored).`;

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
  search_photos_by_color: {
    inputSchema: {
      type: "object",
      properties: {
        color: {
          type: "string",
          enum: [...HUES],
          description:
            "Hue family, measured on the photo as displayed and weighted toward a large center (a subject in the middle counts more than the border). teal is turquoise; brown covers skin, wood and earth tones. A photo holds a color from 3% of its picture; results are ranked by share, most first.",
        },
        tone: {
          type: "string",
          enum: [...COLOR_TONES],
          description: `vives: vivid, colorfulness >= ${TONE_LIMITS.vives}. douces: soft, colorfulness < ${TONE_LIMITS.douces}, not black and white. lumineuse: bright, mean lightness L* > ${TONE_LIMITS.lumineuse}. sombre: dark, L* < ${TONE_LIMITS.sombre}. neutres: nearly colorless, colorfulness < ${TONE_LIMITS.neutres}, not black and white. nb: black and white. Alone, the most colorful photos of the tone first (nb: the least chroma first); with a color, only filters it.`,
        },
        from: {
          type: "string",
          description:
            "First month or day taken, YYYY-MM or YYYY-MM-DD, included",
        },
        to: {
          type: "string",
          description:
            "Last month or day taken, YYYY-MM or YYYY-MM-DD, included",
        },
        limit: {
          type: "number",
          description: `Photos per page, 1-${COLOR_LIMIT.max} (default: ${COLOR_LIMIT.default})`,
        },
        cursor: {
          type: "string",
          description:
            "next_cursor of the previous page, with the same color, tone, from and to",
        },
      },
    },
    outputSchema: { type: "object" },
  },
  get_photo_colors: {
    inputSchema: {
      type: "object",
      properties: {
        photo_id: {
          type: "number",
          description: "The ID of the photo",
        },
      },
      required: ["photo_id"],
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
  list_people: {
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
  },
  get_person_photos: {
    inputSchema: {
      type: "object",
      properties: {
        person: {
          type: ["number", "string"],
          description:
            'The person: person_id from list_people, or the exact name (case-insensitive), e.g. "Suzie"',
        },
        from: {
          type: "string",
          description:
            "Only photos taken on or after this day (YYYY-MM-DD) or instant (ISO, Z)",
        },
        to: {
          type: "string",
          description:
            "Only photos taken on or before this day (whole day included) or instant",
        },
        limit: {
          type: "number",
          description: `Photos per page, 1-${String(MAX_PERSON_PHOTOS)} (default 50)`,
        },
        cursor: {
          type: "string",
          description:
            "next_cursor of the previous page, to get the next one (same person, from and to)",
        },
      },
      required: ["person"],
    },
    outputSchema: { type: "object" },
  },
  get_photo_faces: {
    inputSchema: {
      type: "object",
      properties: {
        photo_id: { type: "number", description: "The photo" },
      },
      required: ["photo_id"],
    },
    outputSchema: { type: "object" },
  },
  semantic_search: {
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'What the photos show, in plain words, in French or another language (e.g. "un gâteau d\'anniversaire", "la plage au coucher du soleil", "a red car")',
        },
        limit: {
          type: "number",
          description: "Photos per page, 1 to 100 (default: 30)",
        },
        cursor: {
          type: "string",
          description:
            "next_cursor from a previous call with the same query, for the next page",
        },
        from: {
          type: "string",
          description:
            "Only photos taken on or after this year, month or day: YYYY, YYYY-MM or YYYY-MM-DD",
        },
        to: {
          type: "string",
          description:
            "Only photos taken on or before this year, month or day: YYYY, YYYY-MM or YYYY-MM-DD",
        },
      },
      required: ["query"],
    },
    outputSchema: { type: "object" },
  },
};

const PEOPLE_TOOLS = [
  {
    name: "list_people",
    description: `People the owner has named. Returns { people: [...], count }. Each person:
- person_id, name.
- birth_date: YYYY-MM-DD, or null when the owner has not given it (then do not compute ages; never guess one).
- photo_count: photos where the person is (one face per photo).
- pending_candidates: faces the machine proposed that the owner has not reviewed yet (not counted in photo_count).
- cover_face_crop_url: a 256 px crop of a recent good face of the person, or null.`,
    inputSchema: toolSchemas.list_people.inputSchema,
  },
  {
    name: "get_person_photos",
    description: `Every photo of one person, oldest first (undated last), one entry per photo, paginated. The library holds copies of some files in several folders (same filename and size): each appears once, the other photo_ids are listed in copies.
Returns { person: {person_id, name, birth_date}, total (photos matching from/to), returned, next_cursor (null on the last page), photos: [...] }.
Each photo: the photo fields below, plus:
- face: the person's own face on it (face fields below) with assignment: "seed" (example picked by the owner), "manual" (confirmed by a person looking at the face), "auto" (accepted by the machine above a similarity threshold measured to be precise; rare mistakes possible); decided_by: "owner", "agent" (an assistant that checked the crop while calibrating: very likely right, not the owner's word), "auto", or null for seeds; similarity: cosine similarity 0-1 to the person's closest known face taken within 18 months (null when nobody proposed it).
- others: who else is on the photo: named [{person_id, name, face_id}] and unknown_count (faces nobody named).
- faces_count: all faces found on the photo.
- copies: photo_ids of the same file elsewhere in the library (not returned again); usually empty.
${PHOTO_FIELDS}
${FACE_FIELDS}
Coverage: only photos the face analysis has looked at can appear; it runs over the whole library, newest years first.`,
    inputSchema: toolSchemas.get_person_photos.inputSchema,
  },
  {
    name: "get_photo_faces",
    description: `All faces found on one photo, with who each one is.
Returns the photo fields below, plus analyzed (false: the face analysis has not looked at this photo yet, so "no faces" means nothing) and faces: [...], each with the face fields below, person ({person_id, name}, or null when nobody named it) and assignment (seed/manual/auto as in get_person_photos; "rejected" means the owner said it is NOT the person in person_id, so treat the face as unnamed; null: never reviewed).
${PHOTO_FIELDS}
${FACE_FIELDS}`,
    inputSchema: toolSchemas.get_photo_faces.inputSchema,
  },
];

// MCP server capabilities and info
const SERVER_INFO = {
  name: "blaze-gallery",
  version: "1.0.0",
};

const SERVER_CAPABILITIES = {
  tools: {},
};

// The whole library's metadata (paths, places, dates): the owner's, or a client holding the API key.
export const POST = requireAuthOrApiKey(async function POST(
  request: NextRequest,
) {
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
              name: "search_photos_by_color",
              description:
                "Find photos by color: those holding `color`, most of it first, or in `tone`, most colorful first; both: the color's photos in that tone. Only dated photos (with a date taken), and only those whose colors the worker has measured. Returns { photos, count, next_cursor }. Each photo is the gallery's photo record (id, filename, folder_path, metadata, thumbnail_url, ...) plus color_score, what it is ranked by: the color's share of the picture (0-1) when a color is given, else its colorfulness (Hasler-Süsstrunk M), or its chroma for nb. next_cursor fetches the next page; null on the last.",
              inputSchema: toolSchemas.search_photos_by_color.inputSchema,
            },
            {
              name: "get_photo_colors",
              description:
                "The colors measured on one photo, as displayed and weighted toward a large center. Returns photo_id and measured (false until the worker has read the photo; nothing else then). When measured: hues, the share of the picture in each of 12 families (red, orange, yellow, green, teal, blue, purple, pink, brown, black, grey, white), summing to 1; colors, the families holding at least 3%, most first; tones, those of search_photos_by_color it is in; palette, up to 5 colors { hex '#rrggbb', share }, most important first, shares summing to 1; colorfulness, Hasler-Süsstrunk M (0 grey, ~33 moderately, ~59 quite, 80+ very colorful); chroma, mean C*; luminance, mean L* (0 black, 100 white); monochrome, black and white; model, the measuring algorithm's version.",
              inputSchema: toolSchemas.get_photo_colors.inputSchema,
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
            ...PEOPLE_TOOLS,
            {
              name: "semantic_search",
              description:
                "Find photos by what they show (objects, scenes, places, events, colors), described in French or any other language; not by filename. Results are ranked by score, the cosine similarity between the query and the photo (higher is closer), and stop below a relevance floor. status: ok; unavailable when the query could not be embedded right now (retry later, or use search_photos); not_indexed when no photo has been analyzed yet. indexed_photos: how many photos have been analyzed so far (the others cannot be found this way yet).",
              inputSchema: toolSchemas.semantic_search.inputSchema,
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
});
