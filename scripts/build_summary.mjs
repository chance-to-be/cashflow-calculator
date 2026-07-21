// data/prices/* + data/subway/ridership.json + data/ref/station_dong.json
// → data/summary.json (동 단위 랭킹용 압축 요약) + data/index.json (메타)
//
// 사용:  node scripts/build_summary.mjs
import fs from 'node:fs';
import {readJson, writeJson, dataDir, recentMonths, round1} from './lib.mjs';

// 여러 달의 [n, 중위가, 평당가, 평균면적] 집계를 거래량 가중으로 병합 (중위값의 근사)
export function mergeBuckets(entries){
  const n = entries.reduce((s, e) => s + e[0], 0);
  if(!n) return null;
  const w = i => entries.reduce((s, e) => s + e[i] * e[0], 0) / n;
  return [n, Math.round(w(1)), round1(w(2)), round1(w(3))];
}

export function buildSummary({regions, priceFiles, ridership, stationDong, months}){
  const last3 = months.slice(-3), prev3 = months.slice(-15, -12);
  const last12 = months.slice(-12);
  const latestSubwayYm = Object.keys(ridership.stations).length
    ? [...new Set(Object.values(ridership.stations).flatMap(s => Object.keys(s.months)))].sort().pop()
    : null;

  // 동 → 역 목록 역인덱스
  const dongStations = new Map(); // `${sgg}|${dong}` → [역명]
  for(const [station, loc] of Object.entries(stationDong.stations || {})){
    const key = `${loc.sgg}|${loc.dong}`;
    if(!dongStations.has(key)) dongStations.set(key, []);
    dongStations.get(key).push(station);
  }

  const rows = [];
  for(const region of regions){
    const data = priceFiles[region.code];
    if(!data) continue;
    // 동 목록
    const dongs = new Set();
    for(const md of Object.values(data.months || {})) for(const d of Object.keys(md)) dongs.add(d);
    for(const dong of dongs){
      const bucketStats = {}, yoy = {};
      for(const b of ['s', 'm', 'l']){
        const cur = last3.map(ym => data.months[ym]?.[dong]?.buckets?.[b]).filter(Boolean);
        const prev = prev3.map(ym => data.months[ym]?.[dong]?.buckets?.[b]).filter(Boolean);
        const c = mergeBuckets(cur);
        if(c) bucketStats[b] = c;
        const p = mergeBuckets(prev);
        if(c && p && p[2] > 0) yoy[b] = round1((c[2] / p[2] - 1) * 100);
      }
      if(!Object.keys(bucketStats).length) continue;
      let vol12 = 0;
      for(const ym of last12){
        const d = data.months[ym]?.[dong];
        if(d) for(const b of Object.values(d.buckets)) vol12 += b[0];
      }
      const stations = dongStations.get(`${region.name}|${dong}`) || [];
      let ride = 0;
      if(latestSubwayYm){
        for(const st of stations){
          const m = ridership.stations[st]?.months?.[latestSubwayYm];
          if(m) ride += m[1]; // 평일 일평균
        }
      }
      rows.push({
        code: region.code, sido: region.sido, sgg: region.name, dong,
        b: bucketStats, yoy, vol12,
        st: stations, ride: ride || null
      });
    }
  }
  return rows;
}

async function main(){
  const D = dataDir();
  const {regions} = readJson(`${D}ref/regions.json`);
  const months = recentMonths(36);
  const priceFiles = {};
  let priceThrough = null;
  for(const r of regions){
    const f = `${D}prices/${r.code}.json`;
    if(fs.existsSync(f)){
      priceFiles[r.code] = readJson(f);
      const ms = Object.keys(priceFiles[r.code].months || {}).sort();
      const last = ms[ms.length - 1];
      if(last && (!priceThrough || last > priceThrough)) priceThrough = last;
    }
  }
  const ridership = readJson(`${D}subway/ridership.json`, {stations: {}});
  const stationDong = readJson(`${D}ref/station_dong.json`, {stations: {}});
  const demo = readJson(`${D}index.json`, {}).demo === true && !process.env.REAL_DATA;

  const rows = buildSummary({regions, priceFiles, ridership, stationDong, months});
  writeJson(`${D}summary.json`, {generated: new Date().toISOString().slice(0, 10), months, rows});
  writeJson(`${D}index.json`, {
    generated: new Date().toISOString().slice(0, 10),
    demo,
    updatedThrough: {trades: priceThrough, subway: ridership.updatedThrough || null},
    regionsWithData: Object.keys(priceFiles).length,
    dongCount: rows.length
  });
  console.log(`요약: 동 ${rows.length}개, 시군구 ${Object.keys(priceFiles).length}/${regions.length}, 실거래 ~${priceThrough}, 지하철 ~${ridership.updatedThrough || '없음'}${demo ? ' [데모]' : ''}`);
}

if(process.argv[1] === new URL(import.meta.url).pathname) await main();
