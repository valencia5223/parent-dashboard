import { useEffect, useState } from 'react';
import { fetchEmergency, fetchKidsClinics, fetchMoonClinics, fetchPharmacies, useFetch } from '../api.js';
import Card, { Body } from './Card.jsx';

// 약국(지금 문 연 곳) · 아이 병원(지금 진료 중인 소아 진료 의원) · 응급실(실시간 남은 병상)
const TABS = [
  { id: 'pharm', label: '지금 문 연 약국' },
  { id: 'kids', label: '아이 병원' },
  { id: 'er', label: '응급실' },
];
const TAB_IDS = TABS.map((t) => t.id);

// 공휴일(병·의원 진료시간의 '공휴일' 칸을 쓰는 날). 대체공휴일 포함, 해마다 새로 넣을 것
const HOLIDAYS = new Set([
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02', '2026-05-05', '2026-05-24', '2026-05-25',
  '2026-06-03', '2026-06-06', '2026-08-15', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03', '2026-10-05',
  '2026-10-09', '2026-12-25',
  '2027-01-01', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09', '2027-03-01', '2027-05-05', '2027-05-13', '2027-06-06',
  '2027-08-15', '2027-08-16', '2027-09-14', '2027-09-15', '2027-09-16', '2027-10-03', '2027-10-04', '2027-10-09', '2027-10-11',
  '2027-12-25', '2027-12-27',
]);
// 오늘 진료시간 칸: 1=월 … 7=일, 8=공휴일
function todaySlot() {
  const d = new Date(Date.now() + 9 * 3600e3);
  if (HOLIDAYS.has(d.toISOString().slice(0, 10))) return 8;
  return d.getUTCDay() || 7;
}
const SHOW = 5;
const km = (d) => (d == null ? '' : d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`);
const mapLink = (o) => `https://map.kakao.com/link/to/${encodeURIComponent(o.name)},${o.lat},${o.lng}`;

// 한국 시각 HHMM 숫자
function nowHM() {
  const d = new Date(Date.now() + 9 * 3600e3);
  return d.getUTCHours() * 100 + d.getUTCMinutes();
}
const toMin = (v) => Math.floor(v / 100) * 60 + (v % 100);
// 2200 → '밤 10시', 1830 → '저녁 6시 30분'
function clockText(v) {
  const h = Math.floor(v / 100) % 24;
  const m = v % 100;
  const part = h < 6 ? '새벽' : h < 12 ? '오전' : h < 18 ? '오후' : h < 21 ? '저녁' : '밤';
  return `${part} ${h % 12 || 12}시${m ? ` ${m}분` : ''}`;
}
// 오늘 영업시간으로 지금 열었는지, 닫을 때까지 몇 분 남았는지 (자정 넘겨 여는 곳도 계산)
function openState(o, now) {
  if (o.start == null || o.end == null) return null;
  const s = toMin(o.start);
  let e = toMin(o.end);
  let n = toMin(now);
  if (e <= s) e += 24 * 60; // 자정을 넘김
  if (n < s && e > 24 * 60) n += 24 * 60;
  return n >= s && n < e ? { left: e - n } : null;
}

function Pharmacies({ pos }) {
  const state = useFetch(() => fetchPharmacies(pos), [pos.lat, pos.lng], { interval: 30 * 60e3 });
  const [now, setNow] = useState(nowHM);
  const [all, setAll] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(nowHM()), 60e3); return () => clearInterval(t); }, []);

  return (
    <Body state={state} lines={4}>
      {(list) => {
        const open = list.map((o) => ({ ...o, st: openState(o, now) })).filter((o) => o.st);
        const far = km(list.at(-1)?.distance);
        if (open.length === 0) {
          return (
            <div className="empty">
              <p>가까운 약국 {list.length}곳({far} 안) 중 지금 문 연 곳이 없어요.</p>
              <small>밤·휴일에는 응급실 탭이나 119 에 전화해 보세요.</small>
            </div>
          );
        }
        const shown = all ? open : open.slice(0, SHOW);
        return (
          <>
            <p className="med-sub">{far} 안 약국 {list.length}곳 중 <b>{open.length}곳</b>이 지금 열려 있어요</p>
            <ul className="med-list">
              {shown.map((o) => (
                <li key={o.id}>
                  <div className="med-main">
                    <p className="med-name">{o.name}</p>
                    <p className="med-meta">
                      <span className={o.st.left <= 30 ? 'med-closing' : 'med-open'}>
                        {o.st.left <= 30 ? `${o.st.left}분 뒤 닫아요` : `${clockText(o.end)}까지`}
                      </span>
                      {' · '}{km(o.distance)}
                    </p>
                  </div>
                  <div className="med-actions">
                    {o.tel && <a className="btn btn-sm" href={`tel:${o.tel}`} aria-label={`${o.name} 전화`}>📞 전화</a>}
                    <a className="btn btn-sm" href={mapLink(o)} target="_blank" rel="noreferrer">길찾기</a>
                  </div>
                </li>
              ))}
            </ul>
            {open.length > SHOW && (
              <button type="button" className="btn btn-block" onClick={() => setAll(!all)} aria-expanded={all}>
                {all ? '접기' : `${open.length - SHOW}곳 더 보기`}
              </button>
            )}
            <p className="card-foot">약국이 신고한 오늘 영업시간 기준이에요. 공휴일이나 갑자기 쉬는 날은 다를 수 있으니 가시기 전에 전화해 보세요.</p>
          </>
        );
      }}
    </Body>
  );
}

function ClinicActions({ o }) {
  return (
    <div className="med-actions">
      {o.tel && <a className="btn btn-sm" href={`tel:${o.tel}`} aria-label={`${o.name} 전화`}>📞 전화</a>}
      <a className="btn btn-sm" href={mapLink(o)} target="_blank" rel="noreferrer">길찾기</a>
    </div>
  );
}

// 달빛어린이병원: 오늘 달빛 진료시간으로 지금 진료 중 / 몇 시부터 / 오늘 끝남 / 오늘 쉼
function moonStatus(o, slot, now) {
  const t = o.times[slot];
  if (!t) return { cls: 'none', text: '오늘은 달빛 진료 없음' };
  const today = { start: t[0], end: t[1] };
  const st = openState(today, now);
  if (st) return { cls: st.left <= 30 ? 'closing' : 'open', text: st.left <= 30 ? `지금 진료 중 · ${st.left}분 뒤 끝` : `지금 진료 중 · ${clockText(t[1])}까지`, open: true };
  if (t[0] > now) return { cls: 'later', text: `오늘 ${clockText(t[0])} ~ ${clockText(t[1])}` };
  return { cls: 'none', text: '오늘 진료 끝' };
}

function MoonClinics({ pos, slot, now }) {
  const state = useFetch(() => fetchMoonClinics(pos), [pos.lat, pos.lng], { interval: 6 * 3600e3 });
  const [all, setAll] = useState(false);
  return (
    <section className="moon-box">
      <h3 className="moon-title">🌙 달빛어린이병원 <small>밤·휴일에 아이를 보는 곳</small></h3>
      <Body state={state} lines={3}>
        {(list) => {
          if (list.length === 0) return <p className="empty">25km 안에 달빛어린이병원이 없어요</p>;
          // 지금 진료 중인 곳을 먼저, 그다음 가까운 순
          const rows = list.map((o) => ({ ...o, ms: moonStatus(o, slot, now) }))
            .sort((a, b) => (b.ms.open ? 1 : 0) - (a.ms.open ? 1 : 0) || a.distance - b.distance);
          const shown = all ? rows : rows.slice(0, 3);
          return (
            <>
              <ul className="med-list">
                {shown.map((o) => (
                  <li key={o.id}>
                    <div className="med-main">
                      <p className="med-name">{o.name}</p>
                      <p className={`moon-st moon-st-${o.ms.cls}`}>{o.ms.text}</p>
                      <p className="med-meta">{km(o.distance)}</p>
                    </div>
                    <ClinicActions o={o} />
                  </li>
                ))}
              </ul>
              {rows.length > 3 && (
                <button type="button" className="btn btn-sm btn-block" onClick={() => setAll(!all)} aria-expanded={all}>
                  {all ? '접기' : `달빛어린이병원 ${rows.length - 3}곳 더 보기`}
                </button>
              )}
            </>
          );
        }}
      </Body>
    </section>
  );
}

function KidsClinics({ pos }) {
  const state = useFetch(() => fetchKidsClinics(pos), [pos.lat, pos.lng], { interval: 6 * 3600e3 });
  const [now, setNow] = useState(nowHM);
  const [all, setAll] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(nowHM()), 60e3); return () => clearInterval(t); }, []);
  const slot = todaySlot();

  return (
    <>
    <MoonClinics pos={pos} slot={slot} now={now} />
    <h3 className="section-title">지금 진료 중인 아이 진료 병·의원</h3>
    <Body state={state} lines={4}>
      {(list) => {
        const withToday = list.map((o) => {
          const t = o.times[slot];
          const today = t ? { start: t[0], end: t[1] } : null;
          return { ...o, today, st: today ? openState(today, now) : null };
        });
        const open = withToday.filter((o) => o.st);
        const later = withToday
          .filter((o) => !o.st && o.today && o.today.start > now)
          .sort((a, b) => a.today.start - b.today.start || a.distance - b.distance);
        const shown = all ? open : open.slice(0, SHOW);
        return (
          <>
            {open.length === 0 ? (
              <div className="empty">
                <p>10km 안 아이 진료 의원 {list.length}곳 중 지금 진료 중인 곳이 없어요.</p>
                <small>열이 아주 높거나 숨쉬기 힘들어하면 응급실 탭을 보시거나 119 에 전화하세요.</small>
              </div>
            ) : (
              <>
                <p className="med-sub">
                  10km 안 아이 진료 의원 {list.length}곳 중 <b>{open.length}곳</b>이 지금 진료 중이에요
                  {slot === 8 && <small> (오늘은 공휴일 진료시간 기준)</small>}
                </p>
                <ul className="med-list">
                  {shown.map((o) => (
                    <li key={o.id}>
                      <div className="med-main">
                        <p className="med-name">{o.name}</p>
                        <p className="med-meta">
                          <span className={o.st.left <= 30 ? 'med-closing' : 'med-open'}>
                            {o.st.left <= 30 ? `${o.st.left}분 뒤 진료 끝` : `${clockText(o.today.end)}까지`}
                          </span>
                          {' · '}{km(o.distance)}
                        </p>
                        {o.note && <p className="med-note">{o.note}</p>}
                      </div>
                      <ClinicActions o={o} />
                    </li>
                  ))}
                </ul>
                {open.length > SHOW && (
                  <button type="button" className="btn btn-block" onClick={() => setAll(!all)} aria-expanded={all}>
                    {all ? '접기' : `${open.length - SHOW}곳 더 보기`}
                  </button>
                )}
              </>
            )}
            {open.length === 0 && later.length > 0 && (
              <>
                <p className="med-sub">오늘 곧 여는 곳</p>
                <ul className="med-list">
                  {later.slice(0, 3).map((o) => (
                    <li key={o.id}>
                      <div className="med-main">
                        <p className="med-name">{o.name}</p>
                        <p className="med-meta"><span className="med-open">{clockText(o.today.start)}에 열어요</span>{' · '}{km(o.distance)}</p>
                      </div>
                      <ClinicActions o={o} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="card-foot">병원이 신고한 진료시간 기준이에요(달빛어린이병원은 달빛 진료시간). 가시기 전에 전화로 확인하세요.</p>
          </>
        );
      }}
    </Body>
    </>
  );
}

function bedLevel(n) {
  if (n == null) return { cls: 'none', text: '병상 정보 없음' };
  if (n <= 0) return { cls: 'full', text: '꽉 참 · 대기 예상' };
  if (n <= 3) return { cls: 'few', text: `남은 병상 ${n} · 여유 적음` };
  return { cls: 'ok', text: `남은 병상 ${n} · 여유 있음` };
}
const bedTime = (v) => (v.length >= 12 ? `${Number(v.slice(8, 10))}:${v.slice(10, 12)} 기준` : '');

function Emergency({ pos }) {
  const state = useFetch(() => fetchEmergency(pos), [pos.lat, pos.lng], { interval: 3 * 60e3 });
  const [all, setAll] = useState(false);
  return (
    <>
      {/* 스크롤하다 잘못 눌리지 않게 작게, 한 줄 오른쪽에 */}
      <p className="er-119">
        <span>위급할 때는 119 에 먼저</span>
        <a className="btn btn-sm btn-119" href="tel:119" aria-label="119 에 전화">📞 119</a>
      </p>
      <Body state={state} lines={4}>
        {(list) => (list.length === 0 ? (
          <p className="empty">20km 안에서 응급실을 찾지 못했어요</p>
        ) : (
          <>
            <ul className="med-list">
              {(all ? list : list.slice(0, SHOW)).map((o) => {
                const lv = bedLevel(o.beds);
                return (
                  <li key={o.id}>
                    <div className="med-main">
                      <p className="med-name">{o.name}</p>
                      <p className={`bed bed-${lv.cls}`}>{lv.text}</p>
                      <p className="med-meta">{km(o.distance)}{o.bedsAt && ` · ${bedTime(o.bedsAt)}`}</p>
                    </div>
                    <div className="med-actions">
                      {o.tel && <a className="btn btn-sm" href={`tel:${o.tel}`} aria-label={`${o.name} 응급실 전화`}>📞 전화</a>}
                      <a className="btn btn-sm" href={mapLink(o)} target="_blank" rel="noreferrer">길찾기</a>
                    </div>
                  </li>
                );
              })}
            </ul>
            {list.length > SHOW && (
              <button type="button" className="btn btn-block" onClick={() => setAll(!all)} aria-expanded={all}>
                {all ? '접기' : `응급실 ${list.length - SHOW}곳 더 보기`}
              </button>
            )}
            <p className="card-foot">남은 병상은 병원이 입력한 참고값이에요(3분마다 새로 고침). 위급하면 119 에 먼저 전화하세요.</p>
          </>
        ))}
      </Body>
    </>
  );
}

const saved = () => { try { return localStorage.getItem('pd_health'); } catch { return null; } };

export default function HealthCard({ pos }) {
  const [tab, setTab] = useState(() => (TAB_IDS.includes(saved()) ? saved() : 'pharm'));
  const pick = (id) => { setTab(id); try { localStorage.setItem('pd_health', id); } catch { /* 저장 못 해도 괜찮음 */ } };
  return (
    <Card title="약국·병원·응급실" icon="💊" wide>
      <div className="chips" role="tablist" aria-label="약국·병원·응급실 고르기">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`chip${tab === t.id ? ' chip-on' : ''}`} onClick={() => pick(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'pharm' && <Pharmacies pos={pos} />}
      {tab === 'kids' && <KidsClinics pos={pos} />}
      {tab === 'er' && <Emergency pos={pos} />}
    </Card>
  );
}
