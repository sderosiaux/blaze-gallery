/**
 * Migration script to create user_sessions table
 * Usage: npx tsx scripts/create-sessions-table.ts
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import { out } from "./cli";

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function createSessionsTable() {
  out("Creating user_sessions table...");

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

  out("user_sessions table created successfully!");

  // Check if table exists
  const result = await pool.query<{ column_name: string; data_type: string }>(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'user_sessions'
    ORDER BY ordinal_position
  `);

  out("Table schema:");
  result.rows.forEach((row) => {
    out(`  ${row.column_name}: ${row.data_type}`);
  });

  await pool.end();
}

void createSessionsTable().catch(async (err: unknown) => {
  console.error("Failed to create table:", err);
  await pool.end();
  process.exit(1);
});
