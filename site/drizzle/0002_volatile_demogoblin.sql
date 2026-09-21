CREATE TABLE `calendar_connections` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`account_email` text NOT NULL,
	`encrypted_secret` text NOT NULL,
	`calendars_json` text DEFAULT '[]' NOT NULL,
	`selected_calendar_ids_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`last_synced_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`calendar_name` text NOT NULL,
	`calendar_color` text DEFAULT '#315f50' NOT NULL,
	`external_uid` text NOT NULL,
	`title` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`location` text,
	`source_updated_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_calendar_events_owner_start` ON `calendar_events` (`owner_id`,`starts_at`);