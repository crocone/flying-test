// Страница мониторинга затрат на ИИ (ТЗ, этап 6). Данные — /api/admin/metrics с паролем ADMIN_TOKEN.
const $ = (id: string) => document.getElementById(id)!;
const usd = (x: number) => `$${(x ?? 0).toFixed(2)}`;
const sec = (ms: number) => `${((ms ?? 0) / 1000).toFixed(1)} с`;

function table(id: string, head: string[], rows: (string | number)[][], numeric: number[] = []) {
  const t = $(id);
  t.innerHTML = '';
  const tr = document.createElement('tr');
  for (const h of head) tr.append(Object.assign(document.createElement('th'), { textContent: h }));
  t.append(tr);
  for (const r of rows) {
    const row = document.createElement('tr');
    r.forEach((c, i) => {
      const td = Object.assign(document.createElement('td'), { textContent: String(c) });
      if (numeric.includes(i)) td.className = 'n';
      row.append(td);
    });
    t.append(row);
  }
  if (!rows.length) {
    const row = document.createElement('tr');
    row.append(Object.assign(document.createElement('td'), { textContent: 'нет данных', colSpan: head.length }));
    t.append(row);
  }
}

async function load(token: string) {
  $('status').textContent = 'Загружаю…';
  const res = await fetch('/api/admin/metrics', { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) return void ($('status').textContent = 'Неверный пароль.');
  if (res.status === 404) return void ($('status').textContent = 'Мониторинг выключен: на сервере не задан ADMIN_TOKEN.');
  if (!res.ok) return void ($('status').textContent = `Ошибка ${res.status}.`);
  try {
    sessionStorage.setItem('adminToken', token);
  } catch { /* приватный режим */ }
  const m = await res.json();
  $('status').textContent = `Обновлено ${new Date().toLocaleString('ru-RU')}.`;
  $('out').hidden = false;
  const tiles = $('tiles');
  tiles.innerHTML = '';
  const tile = (big: string, small: string) => {
    const d = Object.assign(document.createElement('div'), { className: 'tile' });
    d.append(Object.assign(document.createElement('b'), { textContent: big }), Object.assign(document.createElement('span'), { textContent: small }));
    tiles.append(d);
  };
  tile(usd(m.costToday), `затраты сегодня (UTC) из ${usd(m.limits.budgetUsdPerDay)} дневного бюджета`);
  tile(usd(m.total.cost), `затраты всего, генераций ${m.total.n}`);
  tile(String(m.reports.n), `сохранённых отчётов, за сутки ${m.reports.lastDay}, просмотров ${m.reports.views}`);
  tile(`${m.limits.perUserHour} / ${m.limits.perIpHour}`, 'лимит генераций в час: на браузер / на адрес');
  table('days', ['день', 'генераций', 'успешно', 'с картинкой', 'затраты', 'среднее время', 'наибольшее'],
    m.days.map((d: any) => [d.day, d.n, d.ok, d.images, usd(d.cost), sec(d.avg_ms), sec(d.max_ms)]), [1, 2, 3, 4, 5, 6]);
  table('errors', ['код', 'ошибка', 'раз'], m.errors.map((e: any) => [e.status, e.error ?? '', e.n]), [2]);
  table('recent', ['время', 'итог', 'код', 'длилась', 'затраты', 'модель', 'картинка', 'ошибка'],
    m.recent.map((g: any) => [new Date(g.ts).toLocaleString('ru-RU'), g.ok ? 'да' : 'нет', g.status, sec(g.ms), usd(g.cost), g.model, g.image ? 'да' : '', g.error ?? '']), [2, 3, 4]);
}

$('login').addEventListener('submit', (e) => {
  e.preventDefault();
  void load((($('token') as HTMLInputElement).value || '').trim());
});
try {
  const saved = sessionStorage.getItem('adminToken');
  if (saved) void load(saved);
} catch { /* приватный режим */ }
