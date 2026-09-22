// Smoke scenario — exercises the whole harness end-to-end with only
// capabilities that exist today: a spoken-style request, a tool call, and a
// persisted state change. If this fails, the harness itself is broken.
export default {
  id: 'shopping-add',
  title: 'Add an item to the shopping list',
  description:
    'User asks Homeboard to add an item; the shopping tool must run and the item must persist on the eval board.',
  steps: [
    {
      action: 'board-load',
      note: 'Provision the default widgets for the fresh eval board',
    },
    {
      expect_state: [{ kind: 'shopping', exists: true, name: 'shopping-provisioned' }],
    },
    { say: 'Hey Homeboard, add pickles to the shopping list.' },
    {
      expect: [
        { tool_called: 'add_shopping_items' },
        {
          name: 'short-acknowledgement',
          reply_max_words: 12,
        },
        {
          name: 'honest-confirmation',
          judge:
            'The spoken reply confirms the item was added to the shopping list, in one short natural sentence, and does not invent extra details such as quantities or other items.',
        },
      ],
    },
    {
      expect_state: [
        {
          kind: 'shopping',
          exists: true,
          snapshot_includes: /pickles/i,
          name: 'pickles-persisted',
        },
      ],
    },
  ],
};
