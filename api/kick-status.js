export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const channel = req.query.channel || 'zillas';

  if (!/^[a-zA-Z0-9_-]+$/.test(channel)) {
    return res.status(400).json({ error: 'Invalid channel name' });
  }

  try {
    const kickRes = await fetch(`https://kick.com/api/v1/channels/${channel}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://kick.com/',
      },
    });

    if (!kickRes.ok) {
      return res.status(kickRes.status).json({ error: 'Kick API error' });
    }

    const data = await kickRes.json();
    const isLive = !!(data.livestream);

    return res.status(200).json({
      channel,
      is_live: isLive,
      viewer_count: isLive ? (data.livestream.viewer_count ?? 0) : 0,
      stream_title: isLive ? (data.livestream.session_title ?? '') : '',
    });

  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch Kick status' });
  }
}