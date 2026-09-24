// Output decision layer: quick facts stay spoken, structured requests become
// recent visual answers (show_visual), and "keep this" saves the open visual
// to the artifacts gallery via control_visual save.
export default {
  id: 'output-modes',
  title: 'Speech, visual and board outputs are chosen correctly',
  description:
    'A quick fact is answered in speech only; a comparison fills the screen with a generated visual; "keep this" saves it to the artifacts gallery.',
  steps: [
    {
      action: 'board-load',
      note: 'Provision the default widgets for the fresh eval board',
    },
    { say: 'Hey Homeboard, how many grams are in a kilogram?' },
    {
      expect: [
        { tool_not_called: 'show_visual' },
        { tool_not_called: 'create_widget' },
        { name: 'short-answer', reply_max_words: 12 },
        {
          name: 'spoken-fact',
          judge:
            'The assistant answers with the number one thousand (or "1000 grams"), spoken only, with no visual or widget mentioned.',
        },
      ],
    },
    { say: 'Compare three small trees for a shady backyard.' },
    {
      expect: [
        { tool_called: 'show_visual' },
        {
          name: 'points-at-visual',
          judge:
            'The spoken reply is one short sentence pointing at the visual on screen. It does not read out the comparison, list the trees, or describe the content.',
        },
      ],
    },
    { say: 'Keep this.' },
    {
      expect: [
        {
          tool_called: { name: 'control_visual', args: { action: 'save' } },
        },
        {
          name: 'saved-acknowledgement',
          reply_max_words: 12,
        },
      ],
    },
    {
      expect_artifact: [
        {
          name: 'visual-saved-to-gallery',
          saved: true,
        },
      ],
    },
  ],
};
