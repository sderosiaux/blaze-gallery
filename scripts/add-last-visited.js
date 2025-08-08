const Database = require('better-sqlite3')
const path = require('path')

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'database', 'gallery.db')

console.log('🔧 Adding last_visited column to folders table...')

try {
  const db = new Database(dbPath)
  
  // Check if column already exists
  const tableInfo = db.prepare("PRAGMA table_info(folders)").all()
  const hasLastVisited = tableInfo.some(column => column.name === 'last_visited')
  
  if (hasLastVisited) {
    console.log('✅ last_visited column already exists')
  } else {
    // Add the last_visited column
    db.exec(`
      ALTER TABLE folders 
      ADD COLUMN last_visited DATETIME;
    `)
    
    console.log('✅ Added last_visited column to folders table')
  }
  
  db.close()
  console.log('🎉 Database migration completed successfully!')
  
} catch (error) {
  console.error('❌ Migration failed:', error.message)
  process.exit(1)
}