const METABASE_URL = process.env.METABASE_URL || 'https://metabase.xtramiles.in';
const METABASE_API_KEY = process.env.METABASE_API_KEY || '';
const METABASE_DB_ID = Number(process.env.METABASE_DB_ID || 2);

export interface MetabaseRow {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface MetabaseResponse {
  data: {
    cols: { name: string }[];
    rows: unknown[][];
  };
}

/**
 * Execute a native SQL query against Metabase and return rows as objects.
 */
export async function queryMetabase(sql: string): Promise<MetabaseRow[]> {
  const res = await fetch(`${METABASE_URL}/api/dataset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': METABASE_API_KEY,
    },
    body: JSON.stringify({
      database: METABASE_DB_ID,
      type: 'native',
      native: { query: sql },
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Metabase query failed (${res.status}): ${text}`);
  }

  const json: MetabaseResponse = await res.json();
  const cols = json.data.cols.map((c) => c.name);
  return json.data.rows.map((row) => {
    const obj: MetabaseRow = {};
    cols.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

/**
 * Execute a query and return the first row, or null.
 */
export async function queryOne(sql: string): Promise<MetabaseRow | null> {
  const rows = await queryMetabase(sql);
  return rows.length > 0 ? rows[0] : null;
}
