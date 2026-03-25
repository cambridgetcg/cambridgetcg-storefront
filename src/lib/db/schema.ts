import { pgTable, serial, text, integer, real, timestamp, boolean } from "drizzle-orm/pg-core";
import { customType } from "drizzle-orm/pg-core";

const money = customType<{ data: number; driverData: string }>({
  dataType() { return "numeric(10, 2)"; },
  fromDriver(value: string) { return Number(value); },
});

export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  imageUrl: text("image_url"),
  sortOrder: integer("sort_order").default(0),
  active: boolean("active").default(true),
});

export const sets = pgTable("sets", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  releaseDate: text("release_date"),
  sortOrder: integer("sort_order").default(0),
  active: boolean("active").default(true),
});

export const cards = pgTable("cards", {
  id: serial("id").primaryKey(),
  cardNumber: text("card_number").notNull(),
  sku: text("sku").notNull().unique(),
  name: text("name").default(""),
  nameEn: text("name_en"),
  setCode: text("set_code"),
  setName: text("set_name"),
  cardrushUrl: text("cardrush_url"),
  cardrushJpy: integer("cardrush_jpy"),
  gbpJpyRate: real("gbp_jpy_rate"),
  baseGbp: money("base_gbp"),
  price: money("price"),
  gameId: integer("game_id"),
  setId: integer("set_id"),
  category: text("category").default("singles"),
  imageUrl: text("image_url"),
  rarity: text("rarity"),
  stock: integer("stock"),
  shopifyProductId: text("shopify_product_id"),
});
