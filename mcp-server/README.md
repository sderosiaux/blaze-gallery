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

## Installation

1. Navigate to the MCP server directory:
   ```bash
   cd mcp-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the TypeScript code:
   ```bash
   npm run build
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