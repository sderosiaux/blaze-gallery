const Database = require('better-sqlite3')
const path = require('path')

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'database', 'gallery.db')

console.log('🔧 Adding is_favorite column to photos table...')

try {
  const db = new Database(dbPath)
  
  // Check if column already exists
  const tableInfo = db.prepare("PRAGMA table_info(photos)").all()
  const hasIsFavorite = tableInfo.some(column => column.name === 'is_favorite')
  
  if (hasIsFavorite) {
    console.log('✅ is_favorite column already exists')
  } else {
    // Add the is_favorite column
    db.exec(`
      ALTER TABLE photos 
      ADD COLUMN is_favorite BOOLEAN DEFAULT 0;
    `)
    
    console.log('✅ Added is_favorite column to photos table')
  }
  
  db.close()
  console.log('🎉 Favorites migration completed successfully!')
  
} catch (error) {
  console.error('❌ Migration failed:', error.message)
  process.exit(1)
}