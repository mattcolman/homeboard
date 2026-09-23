import { ownerFor, WidgetError } from '@/app/lib/widgets/store';
import { getImage } from '@/app/lib/images';
import { failure } from '@/app/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const owner = ownerFor(request);
    const { id } = await params;
    const image = /^[0-9a-f-]{36}$/i.test(id)
      ? await getImage(owner, id)
      : null;
    if (!image) throw new WidgetError('Not found.', 404);
    return new Response(image.bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': image.mime,
        'Cache-Control': 'private, max-age=86400, immutable',
      },
    });
  } catch (error) {
    return failure(error);
  }
}
