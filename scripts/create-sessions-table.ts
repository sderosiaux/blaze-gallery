/**
 * Migration script to create user_sessions table
 * Usage: npx tsx scripts/create-sessions-table.ts
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function createSessionsTable() {
  console.log('Creating user_sessions table...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id VARCHAR(36) PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      picture TEXT,
      google_id VARCHAR(255),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      last_activity TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_email ON user_sessions(email)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at)
  `);

  console.log('user_sessions table created successfully!');

  // Check if table exists
  const result = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'user_sessions'
    ORDER BY ordinal_position
  `);

  console.log('Table schema:');
  result.rows.forEach(row => {
    console.log(`  ${row.column_name}: ${row.data_type}`);
  });

  await pool.end();
}

createSessionsTable().catch(err => {
  console.error('Failed to create table:', err);
  pool.end();
  process.exit(1);
});
