import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const recipes = sqliteTable('recipes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  canonicalUrl: text('canonical_url').notNull().unique(),
  title: text('title').notNull(),
  sourceName: text('source_name').notNull(),
  sourceAuthor: text('source_author'),
  imageUrl: text('image_url'),
  videoUrl: text('video_url'),
  description: text('description'),
  totalMinutes: integer('total_minutes'),
  servings: text('servings'),
  ingredientsJson: text('ingredients_json').notNull(),
  stepsJson: text('steps_json').notNull(),
  familyNote: text('family_note'),
  favourite: integer('favourite', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
});

export const widgetDefinitions = sqliteTable('widget_definitions', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  specJson: text('spec_json').notNull(),
  createdAt: text('created_at').notNull(),
});
export const widgetInstances = sqliteTable(
  'widget_instances',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    definitionId: text('definition_id').notNull(),
    previousDefinitionId: text('previous_definition_id'),
    title: text('title').notNull(),
    queryKey: text('query_key').notNull(),
    queryText: text('query_text').notNull(),
    bindingJson: text('binding_json').notNull(),
    stateJson: text('state_json').notNull().default('{}'),
    revision: integer('revision').notNull().default(0),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    offlineAllowed: integer('offline_allowed', { mode: 'boolean' })
      .notNull()
      .default(false),
    size: text('size').notNull().default('standard'),
    lastMutationId: text('last_mutation_id').notNull().default(''),
    previousJson: text('previous_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_widgets_owner_query').on(table.ownerId, table.queryKey),
    index('idx_widgets_owner_archived').on(table.ownerId, table.archived),
  ],
);
export const widgetSnapshots = sqliteTable('widget_snapshots', {
  instanceId: text('instance_id').primaryKey(),
  snapshotJson: text('snapshot_json').notNull(),
});
export const widgetPlacements = sqliteTable('widget_placements', {
  instanceId: text('instance_id').primaryKey(),
  layoutsJson: text('layouts_json').notNull().default('{}'),
  ordinal: integer('ordinal').notNull(),
});
export const widgetMutations = sqliteTable('widget_mutations', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  instanceId: text('instance_id').notNull(),
  createdAt: text('created_at').notNull(),
});

export const calendarConnections = sqliteTable('calendar_connections', {
  ownerId: text('owner_id').primaryKey(),
  provider: text('provider').notNull(),
  accountEmail: text('account_email').notNull(),
  encryptedSecret: text('encrypted_secret').notNull(),
  calendarsJson: text('calendars_json').notNull().default('[]'),
  selectedCalendarIdsJson: text('selected_calendar_ids_json')
    .notNull()
    .default('[]'),
  remindersJson: text('reminders_json').notNull().default('[]'),
  shoppingListId: text('shopping_list_id'),
  shoppingSyncedAt: text('shopping_synced_at'),
  shoppingError: text('shopping_error'),
  status: text('status').notNull().default('connected'),
  parserVersion: integer('parser_version').notNull().default(1),
  lastSyncedAt: text('last_synced_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const calendarEvents = sqliteTable(
  'calendar_events',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    calendarId: text('calendar_id').notNull(),
    calendarName: text('calendar_name').notNull(),
    calendarColor: text('calendar_color').notNull().default('#315f50'),
    externalUid: text('external_uid').notNull(),
    title: text('title').notNull(),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    allDay: integer('all_day', { mode: 'boolean' }).notNull().default(false),
    location: text('location'),
    sourceUpdatedAt: text('source_updated_at'),
  },
  (table) => [
    index('idx_calendar_events_owner_start').on(table.ownerId, table.startsAt),
  ],
);
