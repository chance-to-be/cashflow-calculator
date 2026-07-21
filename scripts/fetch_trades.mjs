// 국토부 아파트 매매 실거래가 수집 → data/prices/{시군구코드}.json
//
// 사용:  DATA_GO_KR_KEY=발급키 node scripts/fetch_trades.mjs
// 옵션:  MONTHS=36        조회 기간(개월, 기본 36)
//        MAX_CALLS=800    이번 실행의 API 호출 상한 (개발계정 일 1,000회 제한 대응)
//        REFRESH_RECENT=3 최근 n개월은 매번 다시 수집 (신고 지연·해제거래 반영)
//
// 시군구×월 단위로 증분 수집: 이미 받은 달은 건너뛰므로, 호출 상한에 걸려도
// 여러 번 실행하면 이어서 채워진다.
import {
  recentMonths, median, mean, round1, parseXmlItems, xmlTag,
  normalizeTrade, areaBucket, fetchText, readJson, writeJson, dataDir
} from './lib.mjs';

const KEY = process.env.DATA_GO_KR_KEY;
const MONTHS = Number(process.env.MONTHS) || 36;
const MAX_CALLS = Number(process.env.MAX_CALLS) || 800;
const REFRESH_RECENT = Number(process.env.REFRESH_RECENT) || 3;
const ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';

const {regions} = readJson(new URL('../data/ref/regions.json', import.meta.url).pathname);
const months = recentMonths(MONTHS);
const refreshSet = new Set(months.slice(-REFRESH_RECENT));
let calls = 0;

async function fetchMonth(code, ym){ // 한 시군구의 한 달 치 원거래 목록
  const dealYmd = ym.replace('-', '');
  const rows = [];
  for(let page = 1; page <= 10; page++){
    if(calls >= MAX_CALLS) throw {budget: true};
    calls++;
    const url = `${ENDPOINT}?serviceKey=${KEY}&LAWD_CD=${code}&DEAL_YMD=${dealYmd}&pageNo=${page}&numOfRows=1000`;
    const xml = await fetchText(url);
    const resultCode = xmlTag(xml, 'resultCode');
    if(resultCode && !['00', '000'].includes(resultCode)){
      throw new Error(`API 오류 ${resultCode}: ${xmlTag(xml, 'resultMsg')} (${code} ${ym})`);
    }
    const items = parseXmlItems(xml);
    for(const it of items){
      const t = normalizeTrade(it);
      if(t) rows.push(t);
    }
    const total = Number(xmlTag(xml, 'totalCount')) || items.length;
    if(page * 1000 >= total || items.length === 0) break;
  }
  return rows;
}

// 원거래 → 동별·단지별 월 집계
export function aggregateMonth(rows){
  const dongs = {};
  for(const t of rows){
    const d = dongs[t.dong] ??= {buckets: {s: [], m: [], l: []}, complexes: {}};
    d.buckets[areaBucket(t.area)].push(t);
    if(t.apt){
      const c = d.complexes[t.apt] ??= {trades: [], built: t.built};
      c.trades.push(t);
      if(t.built && !c.built) c.built = t.built;
    }
  }
  const out = {};
  for(const [dong, d] of Object.entries(dongs)){
    const buckets = {};
    for(const [b, list] of Object.entries(d.buckets)){
      if(!list.length) continue;
      buckets[b] = [
        list.length,
        Math.round(median(list.map(t => t.price))),               // 중위가(만원)
        round1(median(list.map(t => t.price / t.area * 3.3058))), // 평당가(만원)
        round1(mean(list.map(t => t.area)))                       // 평균 전용(㎡)
      ];
    }
    const complexes = {};
    for(const [apt, c] of Object.entries(d.complexes)){
      complexes[apt] = [
        c.trades.length,
        Math.round(median(c.trades.map(t => t.price))),
        round1(mean(c.trades.map(t => t.area))),
        c.built || 0
      ];
    }
    out[dong] = {buckets, complexes};
  }
  return out;
}

async function main(){
  if(!KEY){
    console.log('DATA_GO_KR_KEY 미설정 — 실거래가 수집을 건너뜁니다. (docs/DATA_SETUP.md 참고)');
    return;
  }
  let updated = 0, skippedBudget = false;
  for(const region of regions){
    const file = `${dataDir()}prices/${region.code}.json`;
    const cur = readJson(file, {code: region.code, sido: region.sido, name: region.name, months: {}});
    cur.sido = region.sido; cur.name = region.name;
    // 조회 기간 밖으로 밀려난 달 제거
    for(const ym of Object.keys(cur.months)) if(!months.includes(ym)) delete cur.months[ym];
    let dirty = false;
    try{
      for(const ym of months){
        if(cur.months[ym] && !refreshSet.has(ym)) continue;
        const rows = await fetchMonth(region.code, ym);
        cur.months[ym] = aggregateMonth(rows);
        dirty = true;
      }
    }catch(e){
      if(e && e.budget){ skippedBudget = true; }
      else throw e;
    }
    if(dirty){ writeJson(file, cur); updated++; }
    if(skippedBudget) break;
  }
  console.log(`실거래가: API ${calls}회 호출, ${updated}개 시군구 갱신${skippedBudget ? ' (호출 상한 도달 — 다음 실행에서 이어서 수집)' : ''}`);
}

if(process.argv[1] === new URL(import.meta.url).pathname) await main();
