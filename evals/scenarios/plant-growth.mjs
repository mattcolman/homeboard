// "A picture paints a thousand words": an explanation request must become a
// visual-first page (photos / diagrams with captions), never a wall of text.
export default {
  id: 'plant-growth',
  title: 'Explanations are shown as pictures and diagrams, not text',
  description:
    '"Explain how a plant grows" fills the screen with a page built from images and diagrams with short captions; the spoken reply just points at it.',
  steps: [
    {
      action: 'board-load',
      note: 'Provision the default widgets for the fresh eval board',
    },
    { say: 'Hey Homeboard, explain how a plant grows.' },
    {
      expect: [
        { tool_called: 'show_visual' },
        { tool_not_called: 'create_widget' },
        {
          name: 'points-at-visual',
          judge:
            'The spoken reply is one or two short sentences pointing at the visual on screen. It does not explain the stages of plant growth itself.',
        },
      ],
    },
    {
      expect_artifact: [
        { name: 'page-kind', kind: 'page' },
        { name: 'has-visuals', min_visuals: 3 },
        { name: 'not-a-wall-of-text', max_words: 120 },
        {
          name: 'visual-first',
          judge:
            'Given the HTML of the page (images are described by their alt text and captions), the explanation is carried primarily by pictures or diagrams — for example a seed → sprout → seedling → flowering sequence — with text limited to short captions and labels. It would fail if the page is mostly paragraphs or bullet lists.',
        },
      ],
    },
    { say: 'Keep this.' },
    {
      expect: [
        { tool_called: { name: 'control_visual', args: { action: 'keep' } } },
        { name: 'kept-acknowledgement', reply_max_words: 12 },
      ],
    },
    {
      expect_state: [
        {
          kind: 'composition',
          exists: true,
          name: 'promoted-widget-on-board',
        },
      ],
    },
  ],
};
