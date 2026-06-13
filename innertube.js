export async function innerTube(endpoint, body) {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00' } },
      ...body,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`InnerTube respondeu HTTP ${res.status}`);
  return res.json();
}
