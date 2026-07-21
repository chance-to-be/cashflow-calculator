// 데모 데이터 생성 — API 키 없이도 analysis.html이 동작하도록
// 실제 수집 파일과 동일한 형태의 가상 데이터를 만든다 (index.json에 demo:true 표시).
//
// 사용:  node scripts/make_demo.mjs && node scripts/build_summary.mjs
import {recentMonths, writeJson, readJson, dataDir, round1} from './lib.mjs';

// 결정적 의사난수 (실행마다 같은 데모)
function rng(seed){
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
function hashStr(str){
  let h = 5381;
  for(const c of str) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return h;
}

// [시군구코드, 동, 기준 평당가(만원), 연간 추세 %]
const DONGS = [
  ['11680', '역삼동', 7500, 4], ['11680', '대치동', 8200, 3], ['11680', '개포동', 8800, 5], ['11680', '수서동', 5500, 2],
  ['11710', '잠실동', 7000, 3], ['11710', '가락동', 5200, 2], ['11710', '문정동', 4800, 3],
  ['11440', '공덕동', 4800, 4], ['11440', '아현동', 5000, 3], ['11440', '상암동', 3800, 1],
  ['11350', '상계동', 2600, -1], ['11350', '중계동', 3000, 0], ['11350', '월계동', 2400, 1],
  ['11500', '마곡동', 3900, 3], ['11500', '화곡동', 2500, 0], ['11500', '등촌동', 3000, 1],
  ['11200', '행당동', 4600, 3], ['11200', '옥수동', 5300, 3], ['11200', '성수동1가', 6500, 6],
  ['11590', '사당동', 3400, 1], ['11590', '흑석동', 4800, 2], ['11590', '노량진동', 3300, 2],
  ['41135', '정자동', 4200, 2], ['41135', '서현동', 4000, 2], ['41135', '백현동', 5500, 4], ['41135', '야탑동', 3300, 1],
  ['41173', '관양동', 2700, 1], ['41173', '호계동', 2900, 1],
  ['41190', '중동', 2100, -1], ['41190', '상동', 2200, 0], ['41190', '역곡동', 1800, -1],
  ['41281', '화정동', 2000, 0], ['41281', '행신동', 1900, 0], ['41281', '삼송동', 2600, 2],
  ['41570', '장기동', 1600, -2], ['41570', '운양동', 1700, -1], ['41570', '풍무동', 1800, 0],
  ['41450', '망월동', 2800, 3], ['41450', '신장동', 2300, 1], ['41450', '덕풍동', 2200, 1],
  ['41465', '죽전동', 2300, 0], ['41465', '풍덕천동', 2500, 1], ['41465', '성복동', 2700, 1],
  ['41590', '오산동', 3200, 4], ['41590', '진안동', 1500, -1],
  ['28185', '송도동', 2600, 2], ['28185', '연수동', 1700, 0], ['28185', '동춘동', 1800, 0],
  ['28237', '부평동', 1800, -1], ['28237', '부개동', 1700, 0], ['28237', '십정동', 1500, 0],
  ['28200', '구월동', 1700, 0], ['28200', '간석동', 1400, -1], ['28200', '논현동', 1600, 0]
];

// 역: [역명, 평일 일평균 승하차 합] — station_overrides.json 매핑으로 동과 연결됨
const STATIONS = [
  ['강남', 190000], ['역삼', 90000], ['대치', 35000], ['개포동', 15000], ['수서', 40000],
  ['잠실', 180000], ['잠실새내', 45000], ['가락시장', 35000], ['송파', 25000], ['문정', 45000],
  ['공덕', 55000], ['아현', 25000], ['디지털미디어시티', 70000],
  ['노원', 80000], ['상계', 60000], ['중계', 30000], ['월계', 15000], ['석계', 35000],
  ['마곡', 30000], ['마곡나루', 40000], ['화곡', 55000], ['등촌', 30000],
  ['왕십리', 100000], ['행당', 15000], ['옥수', 25000], ['성수', 70000], ['뚝섬', 40000],
  ['사당', 130000], ['이수', 60000], ['흑석', 30000], ['노량진', 70000],
  ['정자', 45000], ['서현', 55000], ['판교', 75000], ['야탑', 50000],
  ['평촌', 40000], ['인덕원', 35000], ['범계', 65000],
  ['중동', 25000], ['신중동', 35000], ['부천시청', 40000], ['상동', 30000], ['역곡', 40000],
  ['화정', 45000], ['행신', 35000], ['삼송', 25000],
  ['장기', 18000], ['운양', 12000], ['풍무', 20000],
  ['미사', 40000], ['하남시청', 20000], ['하남풍산', 15000],
  ['죽전', 30000], ['수지구청', 35000], ['성복', 20000],
  ['동탄', 40000], ['병점', 35000],
  ['인천대입구', 30000], ['센트럴파크', 20000], ['캠퍼스타운', 18000], ['테크노파크', 15000],
  ['지식정보단지', 12000], ['국제업무지구', 8000],
  ['연수', 15000], ['원인재', 18000], ['동춘', 12000],
  ['부평', 90000], ['부개', 25000], ['백운', 15000], ['동암', 30000],
  ['인천시청', 30000], ['예술회관', 25000], ['간석', 15000], ['간석오거리', 20000],
  ['인천논현', 25000], ['소래포구', 15000]
];

const BUCKET_AREA = {s: 49, m: 76, l: 101}; // 평균 전용(㎡)
const PY = 3.3058;

function main(){
  const D = dataDir();
  const {regions} = readJson(`${D}ref/regions.json`);
  const byCode = Object.fromEntries(regions.map(r => [r.code, r]));
  const months = recentMonths(36);

  // ---- 실거래가 파일 ----
  const files = {};
  for(const [code, dong, basePy, trendPct] of DONGS){
    const r = rng(hashStr(code + dong));
    const region = byCode[code];
    const f = files[code] ??= {code, sido: region.sido, name: region.name, months: {}};
    months.forEach((ym, i) => {
      const t = i / 12; // 년
      const drift = basePy * (1 + trendPct / 100 * (t - 2)); // 3년 전→현재로 추세 반영
      const season = 1 + 0.02 * Math.sin(i / 12 * Math.PI * 2);
      const md = f.months[ym] ??= {};
      const buckets = {};
      for(const b of ['s', 'm', 'l']){
        const n = Math.max(0, Math.round((b === 'm' ? 8 : 4) * (0.5 + r())));
        if(!n) continue;
        const py = drift * season * (b === 's' ? 1.12 : b === 'l' ? 0.94 : 1) * (0.97 + r() * 0.06);
        const area = BUCKET_AREA[b] * (0.95 + r() * 0.1);
        buckets[b] = [n, Math.round(py * area / PY), round1(py), round1(area)];
      }
      if(!Object.keys(buckets).length) return;
      const complexes = {};
      const nComplex = 2 + Math.floor(r() * 3);
      for(let c = 1; c <= nComplex; c++){
        const n = 1 + Math.floor(r() * 3);
        const area = 60 + r() * 40;
        const py = drift * season * (0.95 + r() * 0.1);
        complexes[`${dong.replace(/동\d*가?$/, '')} 데모 ${c}단지`] =
          [n, Math.round(py * area / PY), round1(area), 1995 + Math.floor(r() * 25)];
      }
      md[dong] = {buckets, complexes};
    });
  }
  for(const [code, f] of Object.entries(files)) writeJson(`${D}prices/${code}.json`, f);

  // ---- 지하철 승하차 ----
  const stations = {};
  for(const [name, baseWd] of STATIONS){
    const r = rng(hashStr('st' + name));
    const m = {};
    months.forEach((ym, i) => {
      const growth = 1 + 0.03 * (i / 36 - 0.5) * (r() > 0.3 ? 1 : -1);
      const wd = Math.round(baseWd * growth * (0.97 + r() * 0.06));
      m[ym] = [Math.round(wd * 0.87), wd]; // [전체 일평균, 평일 일평균]
    });
    stations[name] = {lines: ['데모'], months: m};
  }
  writeJson(`${D}subway/ridership.json`, {
    stations, fetchedMonths: months, updatedThrough: months[months.length - 1]
  });

  // ---- 역→동 매핑 (수동 시드에서 데모 역만 추출) ----
  const overrides = readJson(`${D}ref/station_overrides.json`).stations;
  const mapped = {};
  for(const [name] of STATIONS) if(overrides[name]) mapped[name] = {...overrides[name], src: 'override'};
  writeJson(`${D}ref/station_dong.json`, {generated: 'demo', stations: mapped});

  writeJson(`${D}index.json`, {demo: true});
  console.log(`데모 데이터 생성: 시군구 ${Object.keys(files).length}, 동 ${DONGS.length}, 역 ${STATIONS.length} — build_summary.mjs를 이어서 실행하세요`);
}

main();
