#!/usr/bin/env node

/**
 * One-time script to update existing folders that have photos but no last_synced timestamp
 * This fixes folders that were synced before the last_synced feature was added
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
  
  // Find folders that have photos but no last_synced timestamp
  const foldersToUpdate = db.prepare(`
    SELECT f.id, f.name, f.path, f.photo_count
    FROM folders f
    WHERE f.photo_count > 0 
      AND f.last_synced IS NULL
  `).all();
  
  console.log(`Found ${foldersToUpdate.length} folders with photos but no sync timestamp`);
  
  if (foldersToUpdate.length > 0) {
    console.log('Folders to update:');
    foldersToUpdate.forEach(folder => {
      console.log(`  - ${folder.path} (${folder.photo_count} photos)`);
    });
    
    // Update all folders with photos to have last_synced timestamp
    const updateStmt = db.prepare(`
      UPDATE folders 
      SET last_synced = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE photo_count > 0 AND last_synced IS NULL
    `);
    
    const result = updateStmt.run();
    console.log(`✅ Updated ${result.changes} folders with sync timestamp`);
    
    // Verify the update
    const updatedCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM folders 
      WHERE photo_count > 0 AND last_synced IS NOT NULL
    `).get().count;
    
    console.log(`✅ Total folders with sync timestamp: ${updatedCount}`);
  } else {
    console.log('✅ All folders with photos already have sync timestamps');
  }
  
  db.close();
  console.log('✅ Database updated successfully');
  
} catch (error) {
  console.error('❌ Error updating database:', error.message);
  process.exit(1);
}