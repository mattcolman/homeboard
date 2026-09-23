CREATE TABLE `artifact_images` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` blob NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_images_owner_expiry` ON `artifact_images` (`owner_id`,`expires_at`);