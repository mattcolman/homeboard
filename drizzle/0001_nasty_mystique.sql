CREATE TABLE `widget_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`spec_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `widget_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`definition_id` text NOT NULL,
	`previous_definition_id` text,
	`title` text NOT NULL,
	`query_key` text NOT NULL,
	`query_text` text NOT NULL,
	`binding_json` text NOT NULL,
	`state_json` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`offline_allowed` integer DEFAULT false NOT NULL,
	`size` text DEFAULT 'standard' NOT NULL,
	`last_mutation_id` text DEFAULT '' NOT NULL,
	`previous_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_widgets_owner_query` ON `widget_instances` (`owner_id`,`query_key`);--> statement-breakpoint
CREATE INDEX `idx_widgets_owner_archived` ON `widget_instances` (`owner_id`,`archived`);--> statement-breakpoint
CREATE TABLE `widget_mutations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`instance_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `widget_placements` (
	`instance_id` text PRIMARY KEY NOT NULL,
	`layouts_json` text DEFAULT '{}' NOT NULL,
	`ordinal` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `widget_snapshots` (
	`instance_id` text PRIMARY KEY NOT NULL,
	`snapshot_json` text NOT NULL
);
