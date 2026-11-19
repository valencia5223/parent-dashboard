import { useEffect, useMemo, useState } from 'react';
import Card from './Card.jsx';
import { fetchHolidays } from '../holidays.js';
import {
  KINDS, REPEATS, TRASH, WEEK, addDays, dayText, daysBetween, ddayText, dow, kindOf, loadLife, loadLunar,
  longBreaks, occurrences, parts, saveLife, solarToLunar, todayStr, yearsText, ymd,
} from '../lifeData.js';

// 생활 달력: 오늘(음력·쓰레기) · 달력 · 다가오는 쉬는 날 · 내 날짜(D-day). 내 날짜는 이 기기에만 저장.
const UPCOMING_SHOW = 5;

export default function LifeCard() {
  const [data, setData] = useState(loadLife);
  const [today, setToday] = useState(todayStr);
  const [holidays, setHolidays] = useState({});
  const [lunarReady, setLunarReady] = useState(false);
  const [form, setForm] = useState(null); // 추가/고치기 창: { ...일정 }
  const [trashOpen, setTrashOpen] = useState(false);
  const year = parts(today)[0];

  // 자정이 지나면 오늘을 바꾼다
  useEffect(() => {
    const t = setInterval(() => setToday(todayStr()), 60e3);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let alive = true;
    Promise.all([fetchHolidays(year - 1), fetchHolidays(year), fetchHolidays(year + 1)])
      .then((list) => { if (alive) setHolidays(Object.assign({}, ...list)); });
    loadLunar().then(() => { if (alive) setLunarReady(true); }).catch(() => {});
    return () => { alive = false; };
  }, [year]);

  const update = (next) => setData(saveLife(next));
  const saveEvent = (ev) => {
    const events = ev.id
      ? data.events.map((e) => (e.id === ev.id ? ev : e))
      : [...data.events, { ...ev, id: `e${Date.now().toString(36)}` }];
    update({ ...data, events });
    setForm(null);
  };
  const removeEvent = (id) => { update({ ...data, events: data.events.filter((e) => e.id !== id) }); setForm(null); };
  const toggleTrash = (kind, d) => {
    const cur = data.trash[kind] || [];
    update({ ...data, trash: { ...data.trash, [kind]: cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort() } });
  };

  const lunar = lunarReady ? solarToLunar(today) : null;
  const trashOn = (s) => TRASH.filter((t) => (data.trash[t.id] || []).includes(dow(s)));
  const trashToday = trashOn(today);
  const trashTomorrow = trashOn(addDays(today, 1));
  const hasTrash = TRASH.some((t) => (data.trash[t.id] || []).length);

  return (
    <Card title="생활 달력" icon="📅" wide>
      <div className="life-today">
        <p className="life-date">
          <strong>오늘 {dayText(today)}</strong>
          {lunar && <span> · 음력 {lunar.intercalation ? '윤' : ''}{lunar.month}월 {lunar.day}일</span>}
          {holidays[today] && <span className="life-hol"> · {holidays[today]}</span>}
        </p>
        {hasTrash ? (
          <p className="life-trash">
            {trashToday.length ? <>오늘 버리는 날: <b>{trashToday.map((t) => `${t.icon} ${t.label}`).join(' · ')}</b></> : '오늘은 버리는 날이 아니에요'}
            {trashTomorrow.length > 0 && <span className="life-trash-next"> · 내일 {trashTomorrow.map((t) => t.label).join('·')}</span>}
          </p>
        ) : null}
      </div>

      <div className="life-grid">
        <MonthView today={today} holidays={holidays} events={data.events} lunarReady={lunarReady}
          trashOn={trashOn} onAdd={(date) => setForm({ title: '', date, repeat: 'yearly', lunar: false, kind: 'birthday' })} onEdit={setForm} />
        <div className="life-side">
          <Upcoming today={today} events={data.events} lunarReady={lunarReady} onEdit={setForm}
            onAdd={() => setForm({ title: '', date: today, repeat: 'yearly', lunar: false, kind: 'birthday' })} />
          <Breaks today={today} holidays={holidays} />
        </div>
      </div>
      <section>
        <button type="button" className="btn btn-sm btn-block" onClick={() => setTrashOpen(!trashOpen)} aria-expanded={trashOpen}>
          🗑️ 쓰레기 버리는 요일 {trashOpen ? '접기' : hasTrash ? '바꾸기' : '정하기'}
        </button>
        {trashOpen && (
          <div className="trash-set">
            {TRASH.map((t) => (
              <div key={t.id} className="trash-row">
                <span className="trash-name">{t.icon} {t.label}</span>
                <div className="trash-days">
                  {WEEK.map((w, i) => {
                    const on = (data.trash[t.id] || []).includes(i);
                    return (
                      <button key={w} type="button" className={`day-chip${on ? ' day-chip-on' : ''}${i === 0 ? ' is-sun' : i === 6 ? ' is-sat' : ''}`}
                        aria-pressed={on} aria-label={`${t.label} ${w}요일`} onClick={() => toggleTrash(t.id, i)}>{w}</button>
                    );
                  })}
                </div>
              </div>
            ))}
            <p className="card-foot">아파트·동네마다 달라요. 관리사무소·구청 안내대로 골라 주세요.</p>
          </div>
        )}
      </section>
      <p className="card-foot">내 날짜는 이 기기에만 저장돼요 · 공휴일은 한국천문연구원 자료(없으면 앱에 넣어 둔 표)</p>
      {form && <EventForm ev={form} onSave={saveEvent} onRemove={removeEvent} onClose={() => setForm(null)} />}
    </Card>
  );
}

// ---------- 달력 ----------
function MonthView({ today, holidays, events, lunarReady, trashOn, onAdd, onEdit }) {
  const [ym, setYm] = useState(() => parts(today).slice(0, 2));
  const [picked, setPicked] = useState(today);
  const [y, m] = ym;
  const first = ymd(y, m, 1);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = ymd(y, m, days);
  const lead = dow(first);
  const move = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setYm([d.getUTCFullYear(), d.getUTCMonth() + 1]); };

  // 이 달에 돌아오는 내 날짜: { 'YYYY-MM-DD': [일정] }
  const byDay = useMemo(() => {
    const map = {};
    for (const ev of events) for (const s of occurrences(ev, first, last)) (map[s] ||= []).push(ev);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, first, last, lunarReady]);

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(ymd(y, m, d));
  const pickedEvents = byDay[picked] || [];
  const pickedTrash = trashOn(picked);

  return (
    <section className="month">
      <header className="month-head">
        <button type="button" className="btn-icon" onClick={() => move(-1)} aria-label="이전 달">‹</button>
        <h3>{y}년 {m}월</h3>
        <button type="button" className="btn-icon" onClick={() => move(1)} aria-label="다음 달">›</button>
        {(y !== parts(today)[0] || m !== parts(today)[1]) && (
          <button type="button" className="btn btn-sm" onClick={() => { setYm(parts(today).slice(0, 2)); setPicked(today); }}>오늘</button>
        )}
      </header>
      <div className="month-grid" role="grid" aria-label={`${y}년 ${m}월`}>
        {WEEK.map((w, i) => <span key={w} className={`month-dow${i === 0 ? ' is-sun' : i === 6 ? ' is-sat' : ''}`}>{w}</span>)}
        {cells.map((s, i) => {
          if (!s) return <span key={`b${i}`} />;
          const wd = dow(s);
          const hol = holidays[s];
          const evs = byDay[s] || [];
          const cls = ['month-day', hol || wd === 0 ? 'is-sun' : wd === 6 ? 'is-sat' : '', s === today ? 'is-today' : '', s === picked ? 'is-picked' : ''].filter(Boolean).join(' ');
          return (
            <button key={s} type="button" className={cls} onClick={() => setPicked(s)} aria-label={`${dayText(s)}${hol ? ` ${hol}` : ''}${evs.length ? ` 일정 ${evs.length}개` : ''}`}>
              <span className="month-num">{parts(s)[2]}</span>
              {hol && <span className="month-hol">{hol.replace(/^대체공휴일.*/, '대체휴일').replace(/ 연휴$/, '')}</span>}
              {evs.length > 0 && <span className="month-dots" aria-hidden>{evs.slice(0, 3).map((e) => kindOf(e.kind).icon).join('')}</span>}
            </button>
          );
        })}
      </div>
      <div className="month-picked">
        <p className="month-picked-title">
          {dayText(picked)} <small>{ddayText(daysBetween(today, picked))}</small>
          {lunarReady && (() => { const l = solarToLunar(picked); return l ? <small> · 음력 {l.intercalation ? '윤' : ''}{l.month}.{l.day}</small> : null; })()}
        </p>
        {holidays[picked] && <p className="life-hol">🎌 {holidays[picked]}</p>}
        {pickedTrash.length > 0 && <p className="life-sub">{pickedTrash.map((t) => `${t.icon} ${t.label}`).join(' · ')} 버리는 날</p>}
        {pickedEvents.map((ev) => (
          <button key={ev.id} type="button" className="ev-row" onClick={() => onEdit(ev)}>
            <span className="ev-icon" aria-hidden>{kindOf(ev.kind).icon}</span>
            <span className="ev-title">{ev.title}{yearsText(ev, picked) && <small> {yearsText(ev, picked)}</small>}</span>
            {ev.lunar && <span className="ev-tag">음력</span>}
          </button>
        ))}
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => onAdd(picked)}>＋ 이 날에 추가</button>
      </div>
    </section>
  );
}

// ---------- 다가오는 내 날짜 ----------
function Upcoming({ today, events, lunarReady, onEdit, onAdd }) {
  const [all, setAll] = useState(false);
  const list = useMemo(() => {
    const to = addDays(today, 400);
    return events
      .map((ev) => ({ ev, on: occurrences(ev, today, to)[0] }))
      .filter((o) => o.on)
      .sort((a, b) => a.on.localeCompare(b.on));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, today, lunarReady]);
  const past = events.filter((ev) => ev.repeat === 'once' && ev.date < today);
  const shown = all ? list : list.slice(0, UPCOMING_SHOW);

  return (
    <section>
      <div className="life-sec-head">
        <h3 className="section-title">내 날짜</h3>
        <button type="button" className="btn btn-sm btn-primary" onClick={onAdd}>＋ 추가</button>
      </div>
      {events.length === 0 ? (
        <p className="empty">생일·기념일·카드값 내는 날·자동차 검사처럼 챙길 날을 넣어 두면 며칠 남았는지 알려 드려요. 음력 생일도 돼요.</p>
      ) : (
        <ul className="ev-list">
          {shown.map(({ ev, on }) => {
            const n = daysBetween(today, on);
            return (
              <li key={ev.id}>
                <button type="button" className="ev-row" onClick={() => onEdit(ev)}>
                  <span className="ev-icon" aria-hidden>{kindOf(ev.kind).icon}</span>
                  <span className="ev-title">
                    {ev.title}{yearsText(ev, on) && <small> {yearsText(ev, on)}</small>}
                    <small className="ev-when">{dayText(on)}{ev.lunar ? ` · 음력 ${parts(ev.date)[1]}.${parts(ev.date)[2]}` : ''} · {REPEATS.find((r) => r.id === ev.repeat)?.label}</small>
                  </span>
                  <span className={`dday${n <= 3 ? ' dday-soon' : ''}`}>{ddayText(n)}</span>
                </button>
              </li>
            );
          })}
          {past.length > 0 && all && past.map((ev) => (
            <li key={ev.id}>
              <button type="button" className="ev-row ev-past" onClick={() => onEdit(ev)}>
                <span className="ev-icon" aria-hidden>{kindOf(ev.kind).icon}</span>
                <span className="ev-title">{ev.title}<small className="ev-when">{dayText(ev.date)} · 지난 날</small></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(list.length > UPCOMING_SHOW || past.length > 0) && (
        <button type="button" className="btn btn-sm btn-block" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? '접기' : `${Math.max(0, list.length - UPCOMING_SHOW) + past.length}개 더 보기`}
        </button>
      )}
    </section>
  );
}

// ---------- 다가오는 쉬는 날 ----------
function Breaks({ today, holidays }) {
  const items = useMemo(() => {
    const to = addDays(today, 365);
    const breaks = longBreaks(holidays, addDays(today, -10), to).filter((b) => b.to >= today);
    const inBreak = (s) => breaks.some((b) => s >= b.from && s <= b.to);
    const singles = Object.keys(holidays).filter((s) => s >= today && s <= to && !inBreak(s))
      .map((s) => ({ from: s, to: s, days: 1, name: holidays[s] }));
    return [...breaks, ...singles].sort((a, b) => a.from.localeCompare(b.from)).slice(0, 3);
  }, [today, holidays]);
  if (!items.length) return null;
  return (
    <section>
      <h3 className="section-title">다가오는 쉬는 날</h3>
      <ul className="ev-list">
        {items.map((b) => {
          const n = daysBetween(today, b.from);
          return (
            <li key={b.from} className="ev-row ev-static">
              <span className="ev-icon" aria-hidden>🎌</span>
              <span className="ev-title">
                {b.name}{b.days >= 3 && <small> 연휴 {b.days}일</small>}
                <small className="ev-when">{b.days > 1 ? `${dayText(b.from)} ~ ${dayText(b.to)}` : dayText(b.from)}</small>
              </span>
              <span className={`dday${n <= 3 ? ' dday-soon' : ''}`}>{n <= 0 ? '쉬는 중' : ddayText(n)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- 날짜 추가·고치기 창 ----------
function EventForm({ ev, onSave, onRemove, onClose }) {
  const [v, setV] = useState(ev);
  const [confirm, setConfirm] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e });
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const submit = (e) => {
    e.preventDefault();
    if (!v.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return;
    onSave({ ...v, title: v.title.trim(), lunar: v.repeat === 'yearly' && v.lunar });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal life-form" role="dialog" aria-modal="true" aria-label={ev.id ? '날짜 고치기' : '날짜 추가'} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <header className="modal-head">
          <h2>{ev.id ? '날짜 고치기' : '날짜 추가'}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        <div className="chips">
          {KINDS.map((k) => (
            <button key={k.id} type="button" className={`chip chip-sm${v.kind === k.id ? ' chip-on' : ''}`} aria-pressed={v.kind === k.id} onClick={() => set('kind')(k.id)}>
              {k.icon} {k.label}
            </button>
          ))}
        </div>
        <label className="field">
          <span>이름</span>
          <input value={v.title} onChange={set('title')} maxLength={30} placeholder="예: 엄마 생신, 결혼기념일, 카드값" autoFocus={!ev.id} required />
        </label>
        <div className="field">
          <span>반복</span>
          <div className="chips">
            {REPEATS.map((r) => (
              <button key={r.id} type="button" className={`chip chip-sm${v.repeat === r.id ? ' chip-on' : ''}`} aria-pressed={v.repeat === r.id} onClick={() => set('repeat')(r.id)}>{r.label}</button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>{v.repeat === 'monthly' ? '날짜 (이 날의 ‘일’로 매달)' : v.lunar ? '음력 날짜 (태어난 해 그대로)' : '날짜'}</span>
          <input type="date" value={v.date} onChange={set('date')} required />
        </label>
        {v.repeat === 'yearly' && (
          <label className="check">
            <input type="checkbox" checked={!!v.lunar} onChange={set('lunar')} /> 음력으로 챙겨요 (예: 음력 생신)
          </label>
        )}
        <div className="form-actions">
          {ev.id && (confirm ? (
            <>
              <button type="button" className="btn btn-danger" onClick={() => onRemove(ev.id)}>정말 지우기</button>
              <button type="button" className="btn" onClick={() => setConfirm(false)}>취소</button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => setConfirm(true)}>지우기</button>
          ))}
          <button type="submit" className="btn btn-primary form-save">저장</button>
        </div>
      </form>
    </div>
  );
}
