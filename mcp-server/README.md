# Blaze Gallery MCP Server

An MCP (Model Context Protocol) server that allows Claude and other AI assistants to query your Blaze Gallery photo collection. This enables natural language interactions with your photo gallery, allowing you to search, browse, and analyze your photos through conversation.

## Features

- **Photo Search**: Find photos by filename, folder path, date range, size, MIME type, and more
- **Folder Browsing**: Navigate folder hierarchies and explore your photo organization
- **Metadata Queries**: Search photos based on EXIF data, GPS coordinates, camera information
- **Favorites & Recents**: Quick access to favorited photos and recently added items
- **Statistics**: Get insights about your photo collection size, organization, and metadata
- **Structured Responses**: All tools include proper input/output schemas for reliable Claude integration

## Available Tools

### Photo Operations
- `search_photos` - Search photos with flexible filters
- `get_photo` - Get detailed information about a specific photo
- `get_folder_photos` - List all photos in a specific folder
- `get_favorite_photos` - Get all favorited photos
- `get_recent_photos` - Get recently added/modified photos

### Folder Operations
- `search_folders` - Search folders with various criteria
- `get_folder` - Get detailed information about a specific folder
- `get_folder_tree` - Browse the folder hierarchy

### Analytics
- `get_gallery_stats` - Get overall gallery statistics
- `get_photo_analytics` - Get efficient analytics breakdown by year, month, or folder (perfect for millions of photos)
- `get_photo_trends` - Get photo trends over time with various metrics and time ranges

## Installation

### Prerequisites
- Node.js v22.13.0 (same version used by Claude Desktop)
- If using nvm: `nvm use` (reads from .nvmrc)

### Setup Steps

1. Navigate to the MCP server directory:
   ```bash
   cd mcp-server
   ```

2. Use the correct Node.js version:
   ```bash
   nvm use  # Uses Node v22.13.0 from .nvmrc
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Build the TypeScript code:
   ```bash
   npm run build
   ```

### Quick Setup
Alternatively, run the setup script from the project root:
```bash
./setup-mcp.sh
```

## Usage with Claude Desktop

1. Add the MCP server to your Claude Desktop configuration file:

   **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

2. Add this configuration:
   ```json
   {
     "mcpServers": {
       "blaze-gallery": {
         "command": "node",
         "args": ["/path/to/blaze-gallery/mcp-server/dist/index.js"],
         "cwd": "/path/to/blaze-gallery"
       }
     }
   }
   ```

3. If your database is in a different location, specify the path:
   ```json
   {
     "mcpServers": {
       "blaze-gallery": {
         "command": "node",
         "args": ["/path/to/blaze-gallery/mcp-server/dist/index.js", "--db-path", "/custom/path/to/gallery.db"],
         "cwd": "/path/to/blaze-gallery"
       }
     }
   }
   ```

4. Restart Claude Desktop

## Example Queries

Once configured, you can ask Claude questions like:

- "Show me my favorite photos"
- "Find all photos from 2024 in the /vacation folder" 
- "What are my largest photo files?"
- "Show me photos taken with a Canon camera"
- "List folders that contain more than 100 photos"
- "Find photos with GPS coordinates"
- "What's the total size of my photo collection?"
- "Show me recent photos added this month"
- **"Give me the breakdown per year of all my photos"** ⭐ (Uses efficient analytics!)
- **"Show me monthly trends for the last year"** ⭐ (Perfect for millions of photos!)
- "How many photos do I have in each folder?"
- "What's my photo upload trend over time?"

## Testing & Development

### Test Client

Use the included test client to quickly test the MCP server without reloading Claude Desktop:

```bash
# Test all tools
npm test -- --db-path /path/to/your/gallery.db

# Test specific tool
npm run test-tool -- --db-path /path/to/gallery.db get_photo_analytics '{"groupBy":"year","limit":5}'

# Test analytics breakdown by month
npm run test-tool -- --db-path /path/to/gallery.db get_photo_analytics '{"groupBy":"month","orderBy":"count","orderDirection":"DESC","limit":10}'

# Test photo trends
npm run test-tool -- --db-path /path/to/gallery.db get_photo_trends '{"timeRange":"last-year","groupBy":"month","metric":"count"}'
```

## Database Requirements

The MCP server requires read access to your Blaze Gallery SQLite database. By default, it looks for the database at:
```
<project-root>/data/database/gallery.db
```

Make sure the database file is accessible and that your Blaze Gallery has been synchronized with your photo collection.

## Security Notes

- The MCP server only has **read access** to your photo database
- No photos are transmitted through the MCP protocol - only metadata
- The server runs locally and doesn't send data to external services
- Photo thumbnails and actual image files remain on your local system

## Development

To work on the MCP server:

1. Make changes to TypeScript files in `src/`
2. Rebuild: `npm run build`
3. Test with Claude Desktop (restart required after changes)

For development with auto-rebuild:
```bash
npm run dev
```

## Troubleshooting

**Claude doesn't see the MCP server:**
- Verify the path in `claude_desktop_config.json` is correct
- Check that the `dist/index.js` file exists after building
- Restart Claude Desktop completely
- Check Claude Desktop's logs for error messages

**Database connection issues:**
- Ensure the database path is correct
- Verify file permissions allow read access
- Make sure the Blaze Gallery database schema is up to date

**Permission errors:**
- The MCP server needs read access to the database file
- Check file/directory permissions in the data folder

## Schema

The MCP server works with the standard Blaze Gallery database schema including:
- `photos` table with metadata, thumbnails, favorites
- `folders` table with hierarchical organization
- `shared_folders` table for access control (read-only)

## Contributing

This MCP server is part of the Blaze Gallery project. Contributions should follow the main project's guidelines and coding standards.