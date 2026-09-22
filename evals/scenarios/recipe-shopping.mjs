// The recipe widget's "add to shopping list" button — and its voice twin
// add_recipe_to_shopping — pushes the open recipe's raw ingredient lines onto
// the shopping list. The store saves those strings verbatim today; the spec
// here is that recipe→shopping curates the list like a cook would:
//   - drop lines for things you can't or don't buy (bubbly active starter —
//     you already keep one; warm water — it comes from the tap)
//   - strip quantities on pantry checks (a few grams of salt → "fine sea salt")
//   - keep quantities on real shopping items ("500 g bread flour")
//
// Partially blocked today: tool selection and the acknowledgement run live;
// the curated-list assertions wait on 'shopping:ingredient-curation'.
export default {
  id: 'recipe-shopping',
  title: 'Add recipe ingredients to the shopping list',
  description:
    'With a sourdough recipe open, adding its ingredients to the shopping list should produce curated items — "500 g bread flour" and "fine sea salt" — not the raw ingredient lines.',
  steps: [
    {
      action: 'board-load',
      note: 'Provision the default widgets (including the shopping list) for the fresh eval board',
    },
    {
      expect_state: [
        { kind: 'shopping', exists: true, name: 'shopping-provisioned' },
      ],
    },
    {
      action: 'seed-recipe:sourdough',
      note: 'Open the fixture recipe (starter, water, flour, salt) and focus it — the button acts on the open recipe',
    },
    {
      expect_state: [
        {
          kind: 'recipe',
          exists: true,
          snapshot_includes: /bread flour/i,
          name: 'recipe-seeded',
        },
      ],
    },
    { say: 'Add this recipe to my shopping list.' },
    {
      expect: [
        { tool_called: 'add_recipe_to_shopping' },
        {
          name: 'short-acknowledgement',
          reply_max_words: 12,
        },
        {
          name: 'honest-confirmation',
          judge:
            'The spoken reply confirms the recipe ingredients were added to the shopping list, in one short natural sentence, and does not enumerate the items or invent extra details.',
        },
      ],
    },
    {
      expect_state: [
        {
          kind: 'shopping',
          snapshot_includes: /bread flour/i,
          name: 'ingredients-reached-list',
        },
      ],
    },
    {
      expect_state: [
        {
          kind: 'shopping',
          snapshot_includes: /"text":"500 g bread flour"/i,
          name: 'flour-keeps-quantity',
          requires: ['shopping:ingredient-curation'],
        },
        {
          kind: 'shopping',
          snapshot_includes: /"text":"fine sea salt"/i,
          name: 'salt-is-pantry-check',
          requires: ['shopping:ingredient-curation'],
        },
        {
          kind: 'shopping',
          snapshot_not_includes: /starter/i,
          name: 'no-starter',
          requires: ['shopping:ingredient-curation'],
        },
        {
          kind: 'shopping',
          snapshot_not_includes: /water/i,
          name: 'no-water',
          requires: ['shopping:ingredient-curation'],
        },
      ],
    },
  ],
};
