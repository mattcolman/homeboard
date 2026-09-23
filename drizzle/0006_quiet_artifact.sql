CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`query_text` text NOT NULL,
	`definition_json` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`state_json` text DEFAULT '{}' NOT NULL,
	`promoted_widget_id` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_artifacts_owner_created` ON `artifacts` (`owner_id`,`created_at`);
