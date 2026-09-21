CREATE TABLE `recipes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`canonical_url` text NOT NULL,
	`title` text NOT NULL,
	`source_name` text NOT NULL,
	`source_author` text,
	`image_url` text,
	`video_url` text,
	`description` text,
	`total_minutes` integer,
	`servings` text,
	`ingredients_json` text NOT NULL,
	`steps_json` text NOT NULL,
	`family_note` text,
	`favourite` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipes_canonical_url_unique` ON `recipes` (`canonical_url`);
