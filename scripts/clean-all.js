#!/usr/bin/env node

/**
 * Clean database and thumbnail cache to start fresh
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Get paths (same as the application uses)
const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'database', 'gallery.db');
const thumbnailsPath = process.env.THUMBNAILS_PATH || path.join(process.cwd(), 'data', 'thumbnails');

console.log('🧹 Starting fresh cleanup...');
console.log('Database path:', dbPath);
console.log('Thumbnails path:', thumbnailsPath);

try {
  // Clean database
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log('✅ Removed database file');
  } else {
    console.log('ℹ️  Database file does not exist');
  }

  // Clean WAL files if they exist
  const walPath = dbPath + '-wal';
  const shmPath = dbPath + '-shm';
  
  if (fs.existsSync(walPath)) {
    fs.unlinkSync(walPath);
    console.log('✅ Removed WAL file');
  }
  
  if (fs.existsSync(shmPath)) {
    fs.unlinkSync(shmPath);
    console.log('✅ Removed SHM file');
  }

  // Clean thumbnails directory
  if (fs.existsSync(thumbnailsPath)) {
    const files = fs.readdirSync(thumbnailsPath);
    let deletedCount = 0;
    
    for (const file of files) {
      const filePath = path.join(thumbnailsPath, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isFile()) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    }
    
    console.log(`✅ Removed ${deletedCount} thumbnail files`);
  } else {
    console.log('ℹ️  Thumbnails directory does not exist');
  }

  console.log('🎉 Cleanup completed successfully!');
  console.log('');
  console.log('Next steps:');
  console.log('1. Start the application');
  console.log('2. Database will be recreated automatically');
  console.log('3. Background sync will populate folders');
  console.log('4. Thumbnails will generate on demand');
  
} catch (error) {
  console.error('❌ Error during cleanup:', error.message);
  process.exit(1);
}