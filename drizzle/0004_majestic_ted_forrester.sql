ALTER TABLE `calendar_connections` ADD `reminders_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_connections` ADD `shopping_list_id` text;--> statement-breakpoint
ALTER TABLE `calendar_connections` ADD `shopping_synced_at` text;--> statement-breakpoint
ALTER TABLE `calendar_connections` ADD `shopping_error` text;