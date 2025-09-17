// tools/update-song.ts
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" }); // <-- explicitly load .env.local

// === EDIT THESE TWO LINES ===
const SONG_ID = 2;                                     // the row to fix
const FILE_PATH = "C:\\Users\\ron31416\\OneDrive\\Documents\\MusicXML\\gymnopedie-no-1-satie.mxl";      // absolute path to the .mxl on disk
// ============================

async function main() {
  const url  = process.env.SUPABASE_URL!;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Read file and encode as hex for Postgres bytea (\x… format)
  const buf = await readFile(FILE_PATH);
  const hex = buf.toString("hex");
  const byteaText = "\\x" + hex;

  const { data, error } = await supabase
    .from("song")
    .update({ song_mxl: byteaText })
    .eq("song_id", SONG_ID)
    .select("song_id");     // just to confirm it matched

  if (error) throw error;
  if (!data || data.length === 0) throw new Error(`No row updated for song_id=${SONG_ID}`);

  console.log(`Updated song_id=${SONG_ID} with ${buf.length} bytes.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
