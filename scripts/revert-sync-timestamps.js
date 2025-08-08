#!/usr/bin/env node

/**
 * Revert the incorrect sync timestamps that were added by the previous script
 * Only mark folders as synced when they're actually processed through sync operations
 */

const Database = require('better-sqlite3');
const path = require('path');

// Get database path (same as the application uses)
const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'database', 'gallery.db');
console.log('Using database:', dbPath);

try {
  const db = new Database(dbPath);
  
  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');
  
  // Clear all last_synced timestamps - let natural sync process set them
  const result = db.prepare(`
    UPDATE folders 
    SET last_synced = NULL
    WHERE last_synced IS NOT NULL
  `).run();
  
  console.log(`✅ Cleared last_synced timestamps from ${result.changes} folders`);
  console.log('✅ Folders will now be marked as synced only when actually processed through sync operations');
  
  db.close();
  console.log('✅ Database reverted successfully');
  
} catch (error) {
  console.error('❌ Error reverting database:', error.message);
  process.exit(1);
}