// 역 → 법정동 매핑 생성 → data/ref/station_dong.json
//
// 매핑 우선순위:
//   1. data/ref/station_overrides.json  수동 검증 매핑
//   2. (선택) 카카오 로컬 API — KAKAO_REST_KEY 설정 시, 남은 역을 좌표→법정동으로 해석
//   3. 이름 휴리스틱 — '○○'역과 정확히 일치하는 '○○동'이 수도권 전체에서 유일할 때만
//
// 사용:  node scripts/build_station_map.mjs        (승하차 데이터의 역 목록 기준)
//        KAKAO_REST_KEY=... node scripts/build_station_map.mjs
import fs from 'node:fs';
import {readJson, writeJson, dataDir, fetchText} from './lib.mjs';

const KAKAO_KEY = process.env.KAKAO_REST_KEY;

// 수도권 전체 법정동 목록: dongName → [{sido, sgg}] (가격 데이터에서 수집)
export function collectDongs(pricesDir){
  const map = new Map();
  if(!fs.existsSync(pricesDir)) return map;
  for(const f of fs.readdirSync(pricesDir)){
    if(!f.endsWith('.json')) continue;
    const region = readJson(pricesDir + f);
    if(!region) continue;
    const dongs = new Set();
    for(const monthData of Object.values(region.months || {})){
      for(const dong of Object.keys(monthData)) dongs.add(dong);
    }
    for(const dong of dongs){
      if(!map.has(dong)) map.set(dong, []);
      map.get(dong).push({sido: region.sido, sgg: region.name});
    }
  }
  return map;
}

// 휴리스틱: 역명+동 이 수도권 유일 법정동일 때만 매핑
export function heuristicMap(station, dongIndex){
  const cands = dongIndex.get(station + '동') || dongIndex.get(station) || [];
  if(cands.length === 1 && station.length >= 2){
    const dong = dongIndex.has(station + '동') ? station + '동' : station;
    return {...cands[0], dong, src: 'name'};
  }
  return null;
}

const SIDO_MAP = {'서울특별시': '서울', '인천광역시': '인천', '경기도': '경기'};

async function kakaoLookup(station){
  const H = {headers: {Authorization: `KakaoAK ${KAKAO_KEY}`}};
  const q = encodeURIComponent(station + '역');
  const search = JSON.parse(await kakaoFetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${q}&category_group_code=SW8&size=3`, H));
  const doc = (search.documents || []).find(d => d.category_group_code === 'SW8');
  if(!doc) return null;
  const region = JSON.parse(await kakaoFetch(`https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${doc.x}&y=${doc.y}`, H));
  const b = (region.documents || []).find(r => r.region_type === 'B'); // 법정동
  if(!b) return null;
  const sido = SIDO_MAP[b.region_1depth_name];
  if(!sido) return null; // 수도권 밖
  return {sido, sgg: b.region_2depth_name, dong: b.region_3depth_name, src: 'kakao'};
}
async function kakaoFetch(url, opts){
  const res = await fetch(url, opts);
  if(!res.ok) throw new Error(`Kakao API HTTP ${res.status}`);
  await new Promise(r => setTimeout(r, 120)); // 쿼터 보호
  return res.text();
}

async function main(){
  const D = dataDir();
  const ridership = readJson(`${D}subway/ridership.json`, {stations: {}});
  const overrides = readJson(`${D}ref/station_overrides.json`, {stations: {}}).stations;
  const existing = readJson(`${D}ref/station_dong.json`, {stations: {}}).stations;
  const dongIndex = collectDongs(`${D}prices/`);

  const out = {};
  let nOver = 0, nKakao = 0, nName = 0, nMiss = 0;
  for(const station of Object.keys(ridership.stations).sort()){
    if(overrides[station]){ out[station] = {...overrides[station], src: 'override'}; nOver++; continue; }
    if(existing[station] && existing[station].src === 'kakao'){ out[station] = existing[station]; nKakao++; continue; }
    if(KAKAO_KEY){
      try{
        const k = await kakaoLookup(station);
        if(k){ out[station] = k; nKakao++; continue; }
      }catch(e){ console.error(`카카오 조회 실패(${station}): ${e.message}`); }
    }
    const h = heuristicMap(station, dongIndex);
    if(h){ out[station] = h; nName++; continue; }
    nMiss++;
  }
  writeJson(`${D}ref/station_dong.json`, {generated: new Date().toISOString().slice(0, 10), stations: out});
  console.log(`역 매핑: 수동 ${nOver} · 카카오 ${nKakao} · 이름 ${nName} · 미매핑 ${nMiss}${!KAKAO_KEY && nMiss ? ' (KAKAO_REST_KEY 설정 시 자동 보완)' : ''}`);
}

if(process.argv[1] === new URL(import.meta.url).pathname) await main();
