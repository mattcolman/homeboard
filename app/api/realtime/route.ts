import { SESSION_CONFIG } from './session';

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return Response.json(
      { error: 'Homeboard voice has not been configured yet.' },
      { status: 503 },
    );
  }

  const sdp = await request.text();

  if (!sdp.trim()) {
    return Response.json({ error: 'Missing WebRTC offer.' }, { status: 400 });
  }

  const form = new FormData();
  form.set('sdp', sdp);
  form.set('session', JSON.stringify(SESSION_CONFIG));

  try {
    const response = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Safety-Identifier': 'homeboard-kitchen-poc',
      },
      body: form,
    });

    const body = await response.text();

    if (!response.ok) {
      console.error('OpenAI Realtime session failed', response.status, body);

      let errorCode = '';
      try {
        const payload = JSON.parse(body) as { error?: { code?: string } };
        errorCode = payload.error?.code ?? '';
      } catch {
        // Keep the upstream response private and fall back to a safe message.
      }

      const error =
        errorCode === 'credit_balance_exhausted' ||
        errorCode === 'insufficient_quota'
          ? 'Homeboard voice needs OpenAI API credits. Add credits in Platform billing, then try again.'
          : response.status === 401
            ? 'The OpenAI API key is invalid. Replace it, then restart Homeboard.'
            : response.status === 429
              ? 'OpenAI is receiving too many requests right now. Please try again shortly.'
              : 'Homeboard could not start listening. Please try again.';

      return Response.json({ error }, { status: response.status });
    }

    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/sdp' },
    });
  } catch (error) {
    console.error('OpenAI Realtime request failed', error);
    return Response.json(
      { error: 'Homeboard could not reach the voice service.' },
      { status: 502 },
    );
  }
}
