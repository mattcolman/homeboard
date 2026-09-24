CREATE TABLE `event_people` (
	`owner_id` text NOT NULL,
	`external_uid` text NOT NULL,
	`member_ids_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `external_uid`)
);
--> statement-breakpoint
ALTER TABLE `family_members` ADD `aliases_json` text DEFAULT '[]' NOT NULL;