CREATE TABLE `network_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`signal_id` text NOT NULL,
	`lang` text DEFAULT 'auto' NOT NULL,
	`body` text NOT NULL,
	`lat` real,
	`lon` real,
	`region` text NOT NULL,
	`country` text NOT NULL,
	`scene` text,
	`author_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`status` text DEFAULT 'visible' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `network_replies_signal_idx` ON `network_replies` (`signal_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `network_replies_author_idx` ON `network_replies` (`author_key`,`created_at`);--> statement-breakpoint
CREATE TABLE `network_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`chain_id` text NOT NULL,
	`kind` text NOT NULL,
	`lang` text DEFAULT 'auto' NOT NULL,
	`body` text NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`region` text NOT NULL,
	`country` text NOT NULL,
	`scene` text,
	`author_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`status` text DEFAULT 'visible' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `network_signals_created_idx` ON `network_signals` (`created_at`);--> statement-breakpoint
CREATE INDEX `network_signals_visible_idx` ON `network_signals` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `network_signals_author_idx` ON `network_signals` (`author_key`,`created_at`);