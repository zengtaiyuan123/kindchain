import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const networkSignals = sqliteTable("network_signals", {
  id: text("id").primaryKey(),
  chainId: text("chain_id").notNull(),
  kind: text("kind").notNull(),
  lang: text("lang").notNull().default("auto"),
  body: text("body").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  region: text("region").notNull(),
  country: text("country").notNull(),
  scene: text("scene"),
  authorKey: text("author_key").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  status: text("status").notNull().default("visible"),
}, (table) => [
  index("network_signals_created_idx").on(table.createdAt),
  index("network_signals_visible_idx").on(table.status, table.expiresAt),
  index("network_signals_author_idx").on(table.authorKey, table.createdAt),
]);

export const networkReplies = sqliteTable("network_replies", {
  id: text("id").primaryKey(),
  signalId: text("signal_id").notNull(),
  lang: text("lang").notNull().default("auto"),
  body: text("body").notNull(),
  lat: real("lat"),
  lon: real("lon"),
  region: text("region").notNull(),
  country: text("country").notNull(),
  scene: text("scene"),
  authorKey: text("author_key").notNull(),
  createdAt: integer("created_at").notNull(),
  status: text("status").notNull().default("visible"),
}, (table) => [
  index("network_replies_signal_idx").on(table.signalId, table.createdAt),
  index("network_replies_author_idx").on(table.authorKey, table.createdAt),
]);
