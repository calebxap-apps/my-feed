import { VAPID_PUBLIC_KEY } from './config.js';

// 아직 안 만든 채널 (탭에 '준비 중'으로 보여줌)
const UPCOMING = [{ id: 'novel-anime', name: '소설·애니', emoji: '📚' }];

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const state = { channel: params.get('channel'), date: params.get('date'), channels: [], index: [] };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter((c) => c != null));
  return node;
}

async function getJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

const fmt = (d, opts) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ...opts }).format(new Date(d + 'T12:00:00+09:00'));

function renderTabs() {
  $('tabs').replaceChildren(
    ...state.channels.map((c) => el('button', {
      class: 'tab', 'aria-current': String(c.id === state.channel),
      onclick: () => go(c.id, null),
    }, `${c.emoji} ${c.name}`)),
    ...UPCOMING.filter((u) => !state.channels.some((c) => c.id === u.id)).map((u) =>
      el('button', { class: 'tab', disabled: true }, `${u.emoji} ${u.name}`, el('small', {}, '준비 중'))),
  );
}

function postmark(channel, date) {
  const svg = $('postmark').content.firstElementChild.cloneNode(true);
  const id = `pm-${Math.random().toString(36).slice(2, 7)}`;
  svg.querySelectorAll('path[id]').forEach((p) => { p.id = `${id}-${p.id}`; });
  svg.querySelectorAll('textPath').forEach((t) => t.setAttribute('href', `#${id}-${t.getAttribute('href').slice(1)}`));
  svg.querySelector('[data-slot="top"]').textContent = '내 소식함';
  svg.querySelector('[data-slot="bot"]').textContent = channel.name;
  svg.querySelector('[data-slot="date"]').textContent = date.slice(5).replace('-', '.');
  return svg;
}

async function renderDay() {
  const day = $('day');
  const channel = state.channels.find((c) => c.id === state.channel);
  if (!state.date) {
    day.replaceChildren(el('p', { class: 'empty' }, '아직 도착한 소식이 없어요. 매일 낮 12시에 첫 묶음이 와요.'));
    return;
  }
  let d;
  try {
    d = await getJson(`data/${state.channel}/${state.date}.json`);
  } catch {
    day.replaceChildren(el('p', { class: 'empty' }, `${fmt(state.date, { month: 'long', day: 'numeric' })} 소식을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 새로고침해 주세요.`));
    return;
  }

  const longDate = fmt(d.date, { month: 'long', day: 'numeric', weekday: 'short' });
  day.replaceChildren(...[
    postmark(channel, d.date),
    el('h2', { class: 'headline' }, d.headline || '오늘은 새 소식이 없어요'),
    el('p', { class: 'meta' }, d.items.length
      ? `후보 ${d.candidateCount}개 중 ${d.items.length}개를 골랐어요`
      : '내일 낮 12시에 다시 확인해요.'),
    d.summarizer === 'fallback'
      ? el('p', { class: 'notice' }, '오늘은 요약이 실패해서 원래 제목과 첫 문장만 담았어요.')
      : null,
    el('ol', { class: 'items' }, d.items.map((it) => el('li', { class: 'item' },
      el('span', { class: 'tag' }, it.tag),
      el('h3', {}, el('a', { href: it.url, target: '_blank', rel: 'noopener' }, it.title)),
      el('p', {}, it.summary),
      el('div', { class: 'src' },
        el('span', {}, it.source),
        el('a', { href: it.url, target: '_blank', rel: 'noopener' }, '원문'),
        it.discussion ? el('a', { href: it.discussion, target: '_blank', rel: 'noopener' }, '개발자 토론') : null,
        it.originalTitle && it.originalTitle !== it.title ? el('span', { class: 'orig' }, it.originalTitle) : null,
      ),
    ))),
  ].filter(Boolean));
  day.classList.remove('enter');
  void day.offsetWidth;
  day.classList.add('enter');
}

function renderArchive() {
  const list = state.index;
  $('archive').replaceChildren(...(list.length ? list.map((d) => el('li', {},
    el('button', { 'aria-current': String(d.date === state.date), onclick: () => go(state.channel, d.date, true) },
      el('span', { class: 'd' }, fmt(d.date, { month: '2-digit', day: '2-digit', weekday: 'short' })),
      el('span', { class: 'h' }, d.headline || '새 소식 없음'),
    ))) : [el('li', { class: 'empty' }, '쌓인 소식이 아직 없어요.')]));
}

async function go(channelId, date, scrollTop) {
  if (channelId !== state.channel || !state.index.length) {
    state.channel = channelId;
    state.index = await getJson(`data/${channelId}/index.json`).catch(() => []);
  }
  state.date = date || state.index[0]?.date || null;
  const url = new URL(location.href);
  url.searchParams.set('channel', state.channel);
  if (date) url.searchParams.set('date', state.date); else url.searchParams.delete('date');
  history.replaceState(null, '', url);
  renderTabs();
  renderArchive();
  await renderDay();
  if (scrollTop) { scrollTo({ top: 0 }); $('main').focus({ preventScroll: true }); }
}

// ── 알림 ───────────────────────────────────────────
function b64ToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

async function renderPush() {
  const box = $('push');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    box.replaceChildren(el('p', {}, '이 브라우저는 알림을 지원하지 않아요. 크롬에서 열어 홈 화면에 추가해 주세요.'));
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (Notification.permission === 'denied') {
    box.replaceChildren(el('p', {}, '알림이 차단돼 있어요. 휴대폰 설정 → 앱 → 내 소식함 → 알림에서 허용해 주세요.'));
    return;
  }
  if (!sub) {
    box.replaceChildren(
      el('p', {}, '매일 낮 12시에 오늘의 소식을 알림으로 받아요.'),
      el('button', { class: 'btn', onclick: turnOn }, '알림 켜기'),
    );
    return;
  }
  const value = JSON.stringify(sub);
  const area = el('textarea', { readonly: true, 'aria-label': '이 기기의 알림 등록값' });
  area.value = value;
  const copyBtn = el('button', { class: 'btn', onclick: async () => {
    try { await navigator.clipboard.writeText(value); } catch { area.select(); document.execCommand('copy'); }
    copyBtn.textContent = '복사했어요';
  } }, '등록값 복사');
  box.replaceChildren(
    el('p', {}, '이 기기는 알림 받을 준비가 됐어요. 아래 등록값을 복사해서 Claude 에게 보내 주면 연결을 마무리해요. 한 번만 하면 돼요.'),
    area,
    el('div', { class: 'row' },
      copyBtn,
      el('button', { class: 'btn ghost', onclick: async () => {
        await reg.showNotification('🤖 알림 시험', { body: '이렇게 알림이 와요.', icon: 'icons/icon-192.png' });
      } }, '시험 알림 보기'),
    ),
  );
}

async function turnOn() {
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    const reg = await navigator.serviceWorker.ready;
    await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
  }
  renderPush();
}

// ── 시작 ───────────────────────────────────────────
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
state.channels = await getJson('data/channels.json').catch(() => []);
if (state.channels.length) await go(state.channel || state.channels[0].id, state.date);
else { renderTabs(); $('day').replaceChildren(el('p', { class: 'empty' }, '아직 도착한 소식이 없어요. 매일 낮 12시에 첫 묶음이 와요.')); }
renderPush();
