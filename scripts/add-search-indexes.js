const Database = require('better-sqlite3')
const path = require('path')

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'database', 'gallery.db')

console.log('🔧 Adding search indexes to database...')

try {
  const db = new Database(dbPath)
  
  // Check existing indexes
  const existingIndexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%search%'").all()
  const indexNames = existingIndexes.map(idx => idx.name)
  
  const indexesToCreate = [
    {
      name: 'idx_photos_filename_search',
      sql: 'CREATE INDEX IF NOT EXISTS idx_photos_filename_search ON photos (filename COLLATE NOCASE)'
    },
    {
      name: 'idx_folders_name_search', 
      sql: 'CREATE INDEX IF NOT EXISTS idx_folders_name_search ON folders (name COLLATE NOCASE)'
    },
    {
      name: 'idx_folders_path_search',
      sql: 'CREATE INDEX IF NOT EXISTS idx_folders_path_search ON folders (path COLLATE NOCASE)'
    },
    {
      name: 'idx_photos_favorite_search',
      sql: 'CREATE INDEX IF NOT EXISTS idx_photos_favorite_search ON photos (is_favorite, created_at DESC)'
    },
    {
      name: 'idx_photos_folder_thumbnail',
      sql: 'CREATE INDEX IF NOT EXISTS idx_photos_folder_thumbnail ON photos (folder_id, thumbnail_status)'
    }
  ]
  
  let createdCount = 0
  let skippedCount = 0
  
  for (const index of indexesToCreate) {
    if (indexNames.includes(index.name)) {
      console.log(`⏭️  Index ${index.name} already exists`)
      skippedCount++
    } else {
      db.exec(index.sql)
      console.log(`✅ Created index: ${index.name}`)
      createdCount++
    }
  }
  
  db.close()
  
  console.log(`🎉 Search indexes setup completed!`)
  console.log(`   Created: ${createdCount} indexes`)
  console.log(`   Skipped: ${skippedCount} indexes (already existed)`)
  console.log(`   Total: ${indexesToCreate.length} indexes`)
  
} catch (error) {
  console.error('❌ Failed to add search indexes:', error.message)
  process.exit(1)
}