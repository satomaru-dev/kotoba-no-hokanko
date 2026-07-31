import fs from "node:fs/promises";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const sql = await fs.readFile(
  new URL("../migrations/001_init.sql", import.meta.url),
  "utf8"
);
const client = new pg.Client({
  connectionString,
  ssl:
    connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
      ? undefined
      : { rejectUnauthorized: false }
});

await client.connect();
try {
  await client.query(sql);
  process.stdout.write("Migration complete\n");
} finally {
  await client.end();
}
