import { VAPID_PUBLIC_KEY } from './config.js';

// 채널 방식별 안내 문구 (digest: 매일 낮 12시 묶음 / event: 소식이 생길 때만)
const EMPTY = {
  digest: '아직 도착한 소식이 없어요. 매일 낮 12시에 첫 묶음이 와요.',
  event: '아직 새 소식이 없어요. 공식 사이트를 3시간마다 확인하다가 소식이 생기면 알려 드려요.',
};
const time = (iso) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

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
  );
}

function postmark(channel, date, hhmm) {
  const svg = $('postmark').content.firstElementChild.cloneNode(true);
  const id = `pm-${Math.random().toString(36).slice(2, 7)}`;
  svg.querySelectorAll('path[id]').forEach((p) => { p.id = `${id}-${p.id}`; });
  svg.querySelectorAll('textPath').forEach((t) => t.setAttribute('href', `#${id}-${t.getAttribute('href').slice(1)}`));
  svg.querySelector('[data-slot="top"]').textContent = '내 소식함';
  svg.querySelector('[data-slot="bot"]').textContent = channel.name;
  svg.querySelector('[data-slot="date"]').textContent = date.slice(5).replace('-', '.');
  svg.querySelector('[data-slot="time"]').textContent = hhmm;
  return svg;
}

async function renderDay() {
  const day = $('day');
  const channel = state.channels.find((c) => c.id === state.channel);
  if (!state.date) {
    day.replaceChildren(el('p', { class: 'empty' }, EMPTY[channel?.mode || 'digest']));
    return;
  }
  let d;
  try {
    d = await getJson(`data/${state.channel}/${state.date}.json`);
  } catch {
    day.replaceChildren(el('p', { class: 'empty' }, `${fmt(state.date, { month: 'long', day: 'numeric' })} 소식을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 새로고침해 주세요.`));
    return;
  }

  const event = d.mode === 'event';
  day.replaceChildren(...[
    postmark(channel, d.date, event ? time(d.generatedAt) : '12:00'),
    el('h2', { class: 'headline' }, d.headline || '오늘은 새 소식이 없어요'),
    el('p', { class: 'meta' }, event
      ? `이날 새 소식 ${d.items.length}개 · 마지막 도착 ${time(d.generatedAt)}`
      : d.items.length
        ? `후보 ${d.candidateCount}개 중 ${d.items.length}개를 골랐어요`
        : '내일 낮 12시에 다시 확인해요.'),
    d.summarizer === 'fallback'
      ? el('p', { class: 'notice' }, '요약이 실패해서 원래 제목과 첫 문장만 담았어요.')
      : null,
    el('ol', { class: 'items' }, d.items.map((it) => el('li', { class: 'item' },
      el('span', { class: 'tag' }, it.tag),
      el('h3', {}, el('a', { href: it.url, target: '_blank', rel: 'noopener' }, it.title)),
      el('p', {}, it.summary),
      el('div', { class: 'src' },
        el('span', {}, it.at && event ? `${it.source} · ${time(it.at)}` : it.source),
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

// 알림이 안 될 때 원인을 찾기 위한 점검 정보 (화면 맨 아래)
async function renderDiag() {
  const lines = [];
  const add = (k, v) => lines.push(`${k}: ${v}`);
  try {
    const chrome = navigator.userAgent.match(/Chrome\/(\d+)/)?.[1];
    add('브라우저', chrome ? `Chrome ${chrome}` : navigator.userAgent.slice(0, 80));
    add('앱 안 브라우저 의심', /; wv\)|KAKAOTALK|NAVER|Instagram|FBAN|Line\//i.test(navigator.userAgent) ? '예' : '아니오');
    add('설치 앱으로 열림', matchMedia('(display-mode: standalone)').matches ? '예' : '아니오');
    add('알림 지원', 'Notification' in window && 'PushManager' in window ? '예' : '아니오');
    if ('Notification' in window) add('Notification.permission', Notification.permission);
    try { add('permissions.query', (await navigator.permissions.query({ name: 'notifications' })).state); } catch (e) { add('permissions.query', e.name); }
    const reg = await navigator.serviceWorker?.getRegistration();
    add('서비스워커', reg?.active ? '켜짐' : '없음');
    if (reg?.pushManager) {
      add('push 권한', await reg.pushManager.permissionState({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) }).catch((e) => e.name));
      add('등록', (await reg.pushManager.getSubscription()) ? '있음' : '없음');
    }
  } catch (e) { add('점검 오류', `${e.name}: ${e.message}`); }
  $('diag').textContent = '[점검 정보]\n' + lines.join('\n');
}

async function renderPush(note) {
  renderDiag();
  const box = $('push');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    box.replaceChildren(el('p', {}, '이 브라우저는 알림을 지원하지 않아요. 크롬에서 열어 홈 화면에 추가해 주세요.'));
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (Notification.permission === 'denied') {
    box.replaceChildren(el('p', {}, '알림이 차단돼 있어요. 크롬 주소창 왼쪽 아이콘 → 권한 → 알림을 허용으로 바꾼 뒤 새로고침해 주세요. 그래도 안 되면 휴대폰 설정 → 애플리케이션 → Chrome → 알림이 켜져 있는지 확인해 주세요.'));
    return;
  }
  if (!sub) {
    box.replaceChildren(
      el('p', {}, '새 소식이 도착하면 휴대폰 알림으로 알려 드려요.'),
      el('button', { class: 'btn', onclick: turnOn }, '알림 켜기'),
      el('p', { class: 'status', role: 'status' }, note || ''),
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

async function turnOn(e) {
  const btn = e.currentTarget;
  const status = btn.nextElementSibling;
  btn.disabled = true;
  status.textContent = '허용 창을 띄우는 중이에요… 창이 뜨면 허용을 눌러 주세요.';
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'default') {
      status.textContent = '허용 창이 닫혔거나 뜨지 않았어요. 주소창 옆에 종 🔔 모양이 보이면 눌러서 허용해 주세요. 없으면 주소창 왼쪽 아이콘 → 권한 → 알림을 허용으로 바꿔 주세요.';
      btn.disabled = false;
      return;
    }
    if (permission !== 'granted') {
      // 권한은 '아직 안 물어봄'인데 거절이 오면: 크롬이 허용 창을 여러 번 닫힌 주소라 자동 거절하는 중
      const auto = permission === 'denied' && Notification.permission === 'default';
      renderPush(auto
        ? '크롬이 허용 창을 띄우지 않고 자동으로 거절했어요. 이 주소에서 허용 창이 여러 번 닫히면 크롬이 한동안 묻지 않아요. 크롬 ⋮ → 설정 → 사이트 설정 → 알림에서 이 사이트를 허용하거나, 며칠 뒤 다시 눌러 주세요.'
        : `크롬이 알림을 허용하지 않았어요 (결과: ${permission}). 주소창 왼쪽 아이콘 → 권한(또는 사이트 설정) → 알림을 '허용'으로 바꾸고 새로고침해 주세요.`);
      return;
    }
    status.textContent = '알림 주소를 만드는 중이에요…';
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
    renderPush(sub ? '' : '허용은 됐지만 알림 주소를 받지 못했어요. 이 문구를 Claude 에게 알려 주세요.');
  } catch (err) {
    status.textContent = `알림을 켜지 못했어요 (${err.name}: ${err.message}). 이 문구를 Claude 에게 알려 주세요.`;
    btn.disabled = false;
  }
}

// ── 시작 ───────────────────────────────────────────
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
state.channels = await getJson('data/channels.json').catch(() => []);
if (state.channels.length) await go(state.channel || state.channels[0].id, state.date);
else { renderTabs(); $('day').replaceChildren(el('p', { class: 'empty' }, EMPTY.digest)); }
renderPush();
