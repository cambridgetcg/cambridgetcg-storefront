import { query } from "@/lib/db";

export interface QuoteRequest {
  id: number;
  reference: string;
  status: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  payment_method: string;
  delivery_method: string;
  notes: string | null;
  admin_notes: string | null;
  quoted_total: string | null;
  offer_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteItem {
  id: number;
  request_id: number;
  description: string;
  game: string | null;
  set_name: string | null;
  condition: string;
  quantity: number;
  customer_notes: string | null;
  offered_price: string | null;
  admin_notes: string | null;
  rejected: boolean;
  images?: QuoteImage[];
}

export interface QuoteImage {
  id: number;
  item_id: number;
  url: string;
  s3_key: string;
}

// ── Generate reference ──

export async function generateQuoteRef(): Promise<string> {
  const today = new Date();
  const dateStr = today.getFullYear().toString() +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");
  const prefix = `QR-${dateStr}-`;

  const result = await query(
    `SELECT reference FROM quote_requests WHERE reference LIKE $1 ORDER BY reference DESC LIMIT 1`,
    [prefix + "%"]
  );

  let seq = 1;
  if (result.rows.length > 0) {
    const lastSeq = parseInt((result.rows[0].reference as string).slice(-4), 10);
    seq = lastSeq + 1;
  }
  return prefix + String(seq).padStart(4, "0");
}

// ── Create quote request ──

export async function createQuoteRequest(data: {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  paymentMethod: string;
  deliveryMethod: string;
  notes?: string;
  items: {
    description: string;
    game?: string;
    set_name?: string;
    condition: string;
    quantity: number;
    customer_notes?: string;
    imageUrls?: { url: string; s3Key: string }[];
  }[];
}): Promise<{ reference: string }> {
  const { default: pg } = await import("pg");
  const raw = process.env.DATABASE_URL || "";
  const cleaned = raw.replace(/[?&]sslmode=[^&]*/g, "").replace(/\?$/, "");
  const pool = new pg.Pool({ connectionString: cleaned, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const reference = await generateQuoteRef();

    const reqResult = await client.query(
      `INSERT INTO quote_requests (reference, customer_name, customer_email, customer_phone, payment_method, delivery_method, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [reference, data.customerName, data.customerEmail, data.customerPhone || null,
       data.paymentMethod, data.deliveryMethod, data.notes || null]
    );
    const requestId = reqResult.rows[0].id;

    for (const item of data.items) {
      const itemResult = await client.query(
        `INSERT INTO quote_items (request_id, description, game, set_name, condition, quantity, customer_notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [requestId, item.description, item.game || null, item.set_name || null,
         item.condition, item.quantity, item.customer_notes || null]
      );
      const itemId = itemResult.rows[0].id;

      if (item.imageUrls) {
        for (const img of item.imageUrls) {
          await client.query(
            `INSERT INTO quote_images (item_id, url, s3_key) VALUES ($1,$2,$3)`,
            [itemId, img.url, img.s3Key]
          );
        }
      }
    }

    await client.query("COMMIT");
    return { reference };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// ── Get quote by reference (customer view) ──

export async function getQuoteByRef(reference: string): Promise<{
  request: QuoteRequest;
  items: QuoteItem[];
} | null> {
  const reqResult = await query(`SELECT * FROM quote_requests WHERE reference = $1`, [reference]);
  if (reqResult.rows.length === 0) return null;

  const request = reqResult.rows[0] as QuoteRequest;
  const itemsResult = await query(`SELECT * FROM quote_items WHERE request_id = $1 ORDER BY id`, [request.id]);
  const items: QuoteItem[] = [];

  for (const row of itemsResult.rows) {
    const item = row as QuoteItem;
    const imgResult = await query(`SELECT * FROM quote_images WHERE item_id = $1 ORDER BY id`, [item.id]);
    item.images = imgResult.rows as QuoteImage[];
    items.push(item);
  }

  return { request, items };
}

// ── List all quotes (admin) ──

export async function listAllQuotes(): Promise<{ request: QuoteRequest; itemCount: number }[]> {
  const result = await query(
    `SELECT qr.*, (SELECT COUNT(*) FROM quote_items WHERE request_id = qr.id) as item_count
     FROM quote_requests qr ORDER BY qr.created_at DESC`
  );
  return result.rows.map((r) => ({
    request: r as QuoteRequest,
    itemCount: parseInt(r.item_count, 10),
  }));
}

// ── Get full quote detail (admin) ──

export async function getQuoteDetail(id: number): Promise<{
  request: QuoteRequest;
  items: QuoteItem[];
} | null> {
  const reqResult = await query(`SELECT * FROM quote_requests WHERE id = $1`, [id]);
  if (reqResult.rows.length === 0) return null;

  const request = reqResult.rows[0] as QuoteRequest;
  const itemsResult = await query(`SELECT * FROM quote_items WHERE request_id = $1 ORDER BY id`, [request.id]);
  const items: QuoteItem[] = [];

  for (const row of itemsResult.rows) {
    const item = row as QuoteItem;
    const imgResult = await query(`SELECT * FROM quote_images WHERE item_id = $1 ORDER BY id`, [item.id]);
    item.images = imgResult.rows as QuoteImage[];
    items.push(item);
  }

  return { request, items };
}

// ── Admin: set item prices and send offer ──

export async function setItemPrices(items: { id: number; offered_price: number | null; rejected: boolean; admin_notes?: string }[]): Promise<void> {
  for (const item of items) {
    await query(
      `UPDATE quote_items SET offered_price = $1, rejected = $2, admin_notes = $3 WHERE id = $4`,
      [item.offered_price?.toFixed(2) ?? null, item.rejected, item.admin_notes || null, item.id]
    );
  }
}

export async function sendOffer(requestId: number, adminNotes?: string): Promise<QuoteRequest> {
  // Calculate total from non-rejected items
  const itemsResult = await query(
    `SELECT SUM(offered_price * quantity) as total FROM quote_items WHERE request_id = $1 AND NOT rejected AND offered_price IS NOT NULL`,
    [requestId]
  );
  const total = parseFloat(itemsResult.rows[0]?.total || "0");

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  const result = await query(
    `UPDATE quote_requests SET status = 'quoted', quoted_total = $1, offer_expires_at = $2,
     admin_notes = $3, updated_at = NOW() WHERE id = $4 RETURNING *`,
    [total.toFixed(2), expiresAt.toISOString(), adminNotes || null, requestId]
  );
  return result.rows[0] as QuoteRequest;
}

// ── Customer: accept or decline ──

export async function respondToOffer(reference: string, accept: boolean): Promise<QuoteRequest | null> {
  const status = accept ? "accepted" : "declined";
  const result = await query(
    `UPDATE quote_requests SET status = $1, updated_at = NOW()
     WHERE reference = $2 AND status = 'quoted' RETURNING *`,
    [status, reference]
  );
  return result.rows[0] as QuoteRequest ?? null;
}
