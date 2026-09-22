// Warm-path variant: a Golf handicap widget with a known value already exists
// on the eval board (seeded via /api/ingest). Asking for the handicap should
// be answered from that data — not from a web search or a guessed number.
//
// Today this is partially blocked: the realtime tools can list widget titles
// but cannot read widget values (no read-widget tool), so "answers-from-widget"
// reports blocked until that capability ships.
export default {
  id: 'golf-handicap-known',
  title: 'Answer from an existing golf handicap widget',
  description:
    'With a live ingest-backed Golf handicap widget on the board, Homeboard should report the real value rather than search or guess.',
  steps: [
    {
      action: 'push-ingest:golf',
      note: 'Seed the eval board with a fresh handicap (facts.handicap)',
    },
    {
      expect_state: [
        {
          title: 'Golf handicap',
          exists: true,
          binding_source: 'golf',
          name: 'widget-seeded',
        },
      ],
    },
    { say: 'Hey Homeboard, what’s my golf handicap?' },
    {
      expect: [
        {
          name: 'no-hallucination',
          judge:
            'The reply must not state a specific handicap number or low-handicap figure unless it is exactly the value in the seeded widget. It must not invent a source such as a website, app, or official record.',
        },
        {
          name: 'answers-from-widget',
          requires: ['tool:read_widget'],
          judge:
            'The assistant reports the handicap value from the existing Golf handicap widget on the board — the exact figure that was seeded — rather than searching the web or declining to answer.',
        },
      ],
    },
    {
      expect: [
        {
          name: 'no-wrong-widget',
          judge:
            'If the assistant created a new widget instead of using the existing Golf handicap widget, it must not contain a fabricated handicap value. A widget that honestly says the data source is needed is acceptable.',
        },
      ],
    },
  ],
};
