import { useEffect, useState } from 'react';
import { fetchEmergency, fetchPharmacies, useFetch } from '../api.js';
import Card, { Body } from './Card.jsx';

// 약국(지금 문 연 곳) · 응급실(실시간 남은 병상) 두 탭
const TABS = [
  { id: 'pharm', label: '지금 문 연 약국' },
  { id: 'er', label: '응급실' },
];
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
  const [tab, setTab] = useState(() => (saved() === 'er' ? 'er' : 'pharm'));
  const pick = (id) => { setTab(id); try { localStorage.setItem('pd_health', id); } catch { /* 저장 못 해도 괜찮음 */ } };
  return (
    <Card title="약국·응급실" icon="💊" wide>
      <div className="chips" role="tablist" aria-label="약국·응급실 고르기">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`chip${tab === t.id ? ' chip-on' : ''}`} onClick={() => pick(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'pharm' ? <Pharmacies pos={pos} /> : <Emergency pos={pos} />}
    </Card>
  );
}
