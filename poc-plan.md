# Homeboard proof of concept plan

## Goal

Prove one thing: a person can tap the microphone on the kitchen iPad, speak naturally, and see Homeboard change to the right visual dashboard while the AI responds aloud.

The POC is successful when this interaction feels convincing. It is not intended to prove production architecture, real household integrations, reliability, or security hardening.

## The demo

Homeboard will understand three kinds of request:

1. **Schedule:** “What have the kids got on today?”
2. **Spending:** “Show me what we spent this month.”
3. **Dinner:** “What should we cook tonight?”

Each request uses fictional data and switches the whole main content area to a purpose-built view. The AI gives a brief spoken response at the same time.

## POC architecture

```text
Tap mic on iPad
      ↓
Browser captures audio
      ↓ WebRTC
OpenAI Realtime session
      ↓ function call: show_dashboard({ view })
React changes the active dashboard
      ↓
Schedule, spending, or dinner view appears
```

The OpenAI API key stays on the server. The browser sends its WebRTC offer to a small Homeboard server endpoint, which creates the Realtime call and returns the connection answer. OpenAI documents this flow through the Realtime `POST /realtime/calls` API: [Create a Realtime call](https://developers.openai.com/api/reference/typescript/resources/realtime/subresources/calls/methods/create).

## Technical approach

### Keep the existing application

Continue with the current React/Vinext Homeboard site. Do not introduce a separate backend project, database, authentication system, or native iPad application.

### Turn the mock-up into three views

Extract the existing visual sections into a small view model:

```ts
type DashboardView = 'home' | 'schedule' | 'spending' | 'dinner';
```

The page owns `activeView` state and renders a fixed React component for that view. All data remains local and fictional.

### Add one server endpoint

Add an endpoint such as `POST /api/realtime` that:

- receives the browser's WebRTC SDP offer;
- adds the Homeboard session instructions and tool definition;
- authenticates to OpenAI using `OPENAI_API_KEY` on the server; and
- returns OpenAI's SDP answer to the browser.

### Give the voice agent one tool

The POC agent receives a single function:

```json
{
  "name": "show_dashboard",
  "parameters": {
    "type": "object",
    "properties": {
      "view": {
        "type": "string",
        "enum": ["home", "schedule", "spending", "dinner"]
      }
    },
    "required": ["view"]
  }
}
```

Its instructions should say:

- infer the best view from natural household language;
- call `show_dashboard` whenever the requested subject changes;
- acknowledge the request in one short spoken sentence; and
- never invent access to real household data.

### Connect the microphone

When the person taps the existing microphone button:

1. Ask Safari for microphone permission.
2. Create a WebRTC peer connection.
3. Attach the microphone audio track.
4. send the SDP offer through `/api/realtime`.
5. Play the remote audio stream returned by the model.
6. Listen to the WebRTC data channel for the `show_dashboard` function call.
7. Update `activeView` and visually indicate listening, thinking, and connected states.

## Build order

### Slice 1 — Dashboard switching

- Refactor the mock-up into `home`, `schedule`, `spending`, and `dinner` views.
- Make the suggested prompt chips switch views without AI.
- Make each view visually complete enough for the demo.

**Outcome:** the UI behavior is ready before voice is introduced.

### Slice 2 — Live voice connection

- Configure `OPENAI_API_KEY` locally and in the hosted environment.
- Add the Realtime session endpoint.
- Connect the microphone button using WebRTC.
- Play the AI's spoken response.

**Outcome:** the iPad can hold a live voice conversation with Homeboard.

### Slice 3 — Voice drives the UI

- Register the `show_dashboard` tool.
- Handle tool-call events on the browser data channel.
- Map each tool argument to an existing React view.
- Add a brief transition and show what Homeboard heard.

**Outcome:** speaking one of the demo requests changes the dashboard.

### Slice 4 — Put it on the kitchen iPad

- Deploy the updated private site.
- Open it in Safari and add it to the Home Screen.
- Grant microphone permission.
- Keep the display awake during the demo.
- Manually try the three target requests in normal kitchen conditions.

**Outcome:** the POC runs where the product is intended to live.

## Definition of working

The POC is working when, on the old iPad:

- tapping the mic clearly starts listening;
- a natural request is understood without exact wording;
- the relevant view appears within a few seconds;
- the AI gives a short spoken acknowledgement; and
- the user can immediately ask for a different view.

This is a manual demo checklist, not an automated test plan.

## Explicitly out of scope

- Real calendars, banking, recipes, or shopping-list integrations
- Login or household identity
- Wake-word or always-listening behavior
- Arbitrary AI-generated HTML
- Caching and saved dashboards
- Persistent conversation history
- Multiple households or users
- Analytics, monitoring, retries, and production hardening
- Automated tests

## Likely first problems

- **Old Safari support:** WebRTC and microphone behavior must be tried on the actual iPad early.
- **Microphone permission:** listening must begin from a deliberate tap, not automatically.
- **Model verbosity:** the session prompt must keep spoken responses short so the visual result remains primary.
- **Tool-call timing:** the view should change as soon as the tool call is received rather than waiting for the spoken response to finish.
- **API key handling:** the permanent OpenAI key must never be shipped to the browser.

## First implementation session

Start with Slice 1 and Slice 2 in the existing site. The concrete target is:

> Tap the microphone, say “show our spending,” hear a short acknowledgement, and see the spending view replace the home dashboard.

Once that single path works end to end, add schedule and dinner as two more values of the same tool rather than building new infrastructure.
