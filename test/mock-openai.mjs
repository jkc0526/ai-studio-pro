import http from 'node:http';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url.endsWith('/chat/completions')) {
      const parsed = JSON.parse(body || '{}');
      const user = parsed.messages?.at(-1)?.content || '';
      return send({
        choices: [{ message: { role: 'assistant', content: `【mock 剧本】收到 ${user.length} 字输入，已改写为漫剧剧本：钩子+悬念。` } }],
        usage: { total_tokens: 123 },
        model: parsed.model,
      });
    }
    if (req.url.endsWith('/images/generations')) {
      return send({ data: [{ b64_json: PNG }] });
    }
    if (req.url.endsWith('/models')) return send({ data: [{ id: 'mock-model' }] });
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'mock: not found ' + req.url } }));
  });
});

server.listen(9911, '127.0.0.1', () => console.log('mock openai on 9911'));
