// The flagship scenario, on a fresh board with no golf data anywhere.
// Target behaviour: don't hallucinate -> ask where the data lives -> connect to
// golf.com.au -> hand login to the user -> answer with the real handicap.
//
// The connect steps need a product capability that doesn't exist yet (a
// connect/browse tool the model can invoke), so they report "blocked" today.
// The login+sync actions DO run (harness-level connector): they prove the data
// path so the final expectations can run for real once the product side lands.
export default {
  id: 'golf-handicap-connect',
  title: 'Cold-start: find and connect a new personal data source',
  description:
    'Asked for a golf handicap with no widget or connection, Homeboard should not hallucinate, should ask where to look, connect to golf.com.au via a login handoff, and answer with the real value.',
  browser: true,
  steps: [
    { say: 'Hey Homeboard, what’s my golf handicap?' },
    {
      expect: [
        {
          name: 'no-hallucination',
          judge:
            'The reply does not state a specific handicap value and does not invent personal golf data, memberships, or sources. Saying it does not have the information is fine.',
        },
        {
          name: 'seeks-source',
          judge:
            'The assistant either asks the user where the handicap can be found / which service holds it, or explicitly offers a concrete credible way to get it (such as connecting their golf account). Merely showing a generic "what is a handicap" widget does not satisfy this.',
        },
      ],
    },
    { say: 'It should be on golf.com.au' },
    {
      requires: ['tool:connect_source'],
      expect: [
        {
          name: 'initiates-connect',
          judge:
            'The assistant begins connecting to golf.com.au and tells the user a login is needed — it does not give up, search the public web for a number, or claim it already has access.',
        },
        { tool_called: 'connect_source' },
      ],
    },
    {
      requires: ['connector:golf.com.au'],
      action: 'golf-login',
      note: 'Headed Chrome to golf.com.au — fills credentials if set, otherwise asks you to log in.',
    },
    {
      requires: ['connector:golf.com.au'],
      action: 'golf-sync',
      note: 'Captures the real handicap via the site API and pushes it to the eval board (facts.handicap).',
    },
    {
      requires: ['connector:golf.com.au'],
      expect_state: [
        {
          title: 'Golf handicap',
          exists: true,
          binding_source: 'golf',
          snapshot_includes: '${facts.handicap}',
          name: 'handicap-on-board',
        },
      ],
    },
    {
      requires: ['tool:read_widget'],
      say: 'So what is it?',
      expect: [
        {
          name: 'correct-answer',
          judge:
            'The reply states the real handicap ${facts.handicap} (a value within 0.3 is acceptable if phrased as approximate).',
        },
      ],
    },
  ],
};
