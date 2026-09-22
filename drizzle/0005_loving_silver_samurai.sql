CREATE TABLE `family_members` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`emoji` text DEFAULT '' NOT NULL,
	`calendar_ids_json` text DEFAULT '[]' NOT NULL,
	`ordinal` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_family_members_owner` ON `family_members` (`owner_id`);