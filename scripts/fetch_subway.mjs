// 서울열린데이터광장 지하철 역별 일별 승하차(CardSubwayStatsNew) 수집
// → 역·월 단위 일평균으로 집계해 data/subway/ridership.json
//
// 사용:  SEOUL_OPEN_KEY=발급키 node scripts/fetch_subway.mjs
// 옵션:  MONTHS=36           조회 기간(개월, 기본 36)
//        MAX_MONTHS_PER_RUN=6 이번 실행에서 새로 수집할 월 수 (일 단위 API라 한 달 ≈ 30~60회 호출)
//
// 월 단위 증분: 이미 집계된 달은 건너뛴다. 최근 1개월은 매번 재수집.
import {
  recentMonths, daysInMonth, mean, normalizeSubwayRow,
  fetchText, readJson, writeJson, dataDir
} from './lib.mjs';

const KEY = process.env.SEOUL_OPEN_KEY;
const MONTHS = Number(process.env.MONTHS) || 36;
const MAX_MONTHS_PER_RUN = Number(process.env.MAX_MONTHS_PER_RUN) || 6;
// 열린데이터광장 API는 http 전용 포트(8088)를 사용한다 (공개 통계 데이터).
const BASE = `http://openapi.seoul.go.kr:8088/${KEY}/json/CardSubwayStatsNew`;

async function fetchDate(ymd){ // 하루치 전 역 승하차
  const rows = [];
  for(let start = 1; start <= 3001; start += 1000){
    const txt = await fetchText(`${BASE}/${start}/${start + 999}/${ymd}`);
    const json = JSON.parse(txt);
    const body = json.CardSubwayStatsNew;
    if(!body){
      const code = json.RESULT?.CODE || '?';
      if(code === 'INFO-200') return rows; // 해당 날짜 데이터 없음
      throw new Error(`API 오류 ${code}: ${json.RESULT?.MESSAGE || txt.slice(0, 200)}`);
    }
    for(const r of body.row || []){
      const n = normalizeSubwayRow(r);
      if(n) rows.push(n);
    }
    if(start + 999 >= Number(body.list_total_count || 0)) break;
  }
  return rows;
}

// [{line, station, ride, alight} × 날짜들] → 역별 {일평균 승하차 합, 호선 목록}
export function aggregateStations(daily){ // daily: Map<ymd, rows>
  const acc = {}; // station → {lines:Set, byDate: Map<ymd, total>}
  for(const [ymd, rows] of daily){
    for(const r of rows){
      const a = acc[r.station] ??= {lines: new Set(), byDate: new Map()};
      if(r.line) a.lines.add(r.line);
      a.byDate.set(ymd, (a.byDate.get(ymd) || 0) + r.ride + r.alight);
    }
  }
  const out = {};
  for(const [station, a] of Object.entries(acc)){
    const totals = [...a.byDate.values()];
    const weekday = [...a.byDate.entries()]
      .filter(([ymd]) => {
        const d = new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00Z`).getUTCDay();
        return d >= 1 && d <= 5;
      })
      .map(([, v]) => v);
    out[station] = {
      lines: [...a.lines].sort(),
      avg: Math.round(mean(totals)),          // 일평균 승하차 (전체)
      avgWd: Math.round(mean(weekday) || mean(totals)) // 평일 일평균
    };
  }
  return out;
}

async function main(){
  if(!KEY){
    console.log('SEOUL_OPEN_KEY 미설정 — 지하철 승하차 수집을 건너뜁니다. (docs/DATA_SETUP.md 참고)');
    return;
  }
  const file = `${dataDir()}subway/ridership.json`;
  const cur = readJson(file, {stations: {}, fetchedMonths: []});
  const months = recentMonths(MONTHS);
  const done = new Set(cur.fetchedMonths.filter(m => months.includes(m)));
  done.delete(months[months.length - 1]); // 최근 달은 재수집
  const todo = months.filter(m => !done.has(m)).slice(-MAX_MONTHS_PER_RUN);

  let calls = 0;
  for(const ym of todo){
    const daily = new Map();
    for(let d = 1; d <= daysInMonth(ym); d++){
      const ymd = ym.replace('-', '') + String(d).padStart(2, '0');
      daily.set(ymd, await fetchDate(ymd));
      calls++;
    }
    const agg = aggregateStations(daily);
    for(const [station, s] of Object.entries(agg)){
      const st = cur.stations[station] ??= {lines: [], months: {}};
      st.lines = [...new Set([...st.lines, ...s.lines])].sort();
      st.months[ym] = [s.avg, s.avgWd];
    }
    done.add(ym);
  }
  // 조회 기간 밖 데이터 정리
  for(const st of Object.values(cur.stations)){
    for(const ym of Object.keys(st.months)) if(!months.includes(ym)) delete st.months[ym];
  }
  for(const name of Object.keys(cur.stations)){
    if(!Object.keys(cur.stations[name].months).length) delete cur.stations[name];
  }
  cur.fetchedMonths = [...done].sort();
  cur.updatedThrough = cur.fetchedMonths[cur.fetchedMonths.length - 1] || null;
  writeJson(file, cur);
  const remaining = months.filter(m => !done.has(m)).length;
  console.log(`지하철: ${todo.length}개월 수집(호출 ${calls}회), 역 ${Object.keys(cur.stations).length}개${remaining ? `, 미수집 ${remaining}개월 남음 — 다음 실행에서 이어서` : ''}`);
}

if(process.argv[1] === new URL(import.meta.url).pathname) await main();
