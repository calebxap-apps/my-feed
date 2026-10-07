// 내 컴퓨터에서 앱 화면 미리 보기: node scripts/serve.mjs → http://localhost:5173
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { ROOT } from './lib/common.mjs';

const DOCS = join(ROOT, 'docs');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const port = Number(process.env.PORT) || 5173;

createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (!path || path.endsWith('/') || path.endsWith('\\')) path += 'index.html';
  const file = join(DOCS, path);
  if (!file.startsWith(DOCS)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': (TYPES[extname(file)] || 'application/octet-stream') + '; charset=utf-8' }).end(body);
  } catch {
    res.writeHead(404).end('없음');
  }
}).listen(port, () => console.log(`미리 보기: http://localhost:${port}`));
