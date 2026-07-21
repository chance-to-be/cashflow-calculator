# 📊 동네 분석 — 실제 공공데이터 연결하기

`analysis.html`은 저장소의 `data/` 폴더에 있는 정적 JSON을 읽습니다.
처음에는 **데모 데이터**가 들어 있고, 아래처럼 API 키를 등록하면
GitHub Actions(`.github/workflows/update-data.yml`)가 **화·금 새벽마다 자동으로**
실제 데이터를 수집해 커밋합니다 (커밋되면 Pages도 자동 재배포).

## 1. API 키 발급 (무료)

| 시크릿 이름 | 발급처 | 용도 |
|---|---|---|
| `DATA_GO_KR_KEY` | [공공데이터포털](https://www.data.go.kr) → 「아파트 매매 실거래가 자료」 활용신청 | 수도권 77개 시군구 실거래가 |
| `SEOUL_OPEN_KEY` | [서울열린데이터광장](https://data.seoul.go.kr) → 인증키 신청 | 지하철 역별 승하차 인원 |
| `KAKAO_REST_KEY` (선택) | [카카오 개발자](https://developers.kakao.com) REST API 키 | 역→법정동 매핑 자동 보완 |

- 공공데이터포털은 **활용신청 승인 후** 키가 활성화됩니다 (보통 1~2시간).
- 카카오 키가 없어도 동작합니다 — 수동 매핑(주요 200여 역) + 이름 휴리스틱만 사용.

## 2. 저장소에 시크릿 등록

GitHub 저장소 → **Settings → Secrets and variables → Actions → New repository secret**
에서 위 이름 그대로 등록합니다.

## 3. 첫 수집 실행

**Actions 탭 → Update analysis data → Run workflow**를 눌러 수동 실행합니다.

- 실거래가는 시군구×월 단위 **증분 수집**입니다. 공공데이터포털 개발계정은
  일 호출 1,000회 제한이 있어 한 번에 다 못 받습니다 — 첫 3~4회 실행(또는
  스케줄 실행 2주 정도)이면 36개월 × 77개 시군구가 모두 채워집니다.
- 지하철 승하차는 일별 API라 실행당 6개월씩 수집합니다 (마찬가지로 이어서 채움).
- 실제 데이터가 수집되면 데모 표시가 자동으로 사라집니다.

## 로컬에서 돌려보기

```bash
DATA_GO_KR_KEY=... node scripts/fetch_trades.mjs
SEOUL_OPEN_KEY=... node scripts/fetch_subway.mjs
node scripts/build_station_map.mjs      # KAKAO_REST_KEY=... 선택
REAL_DATA=1 node scripts/build_summary.mjs
npx serve .                             # analysis.html은 fetch를 쓰므로 서버 필요
```

데모 데이터로 되돌리려면: `node scripts/make_demo.mjs && node scripts/build_summary.mjs`

테스트: `node scripts/pipeline.test.mjs`

## 데이터 구조

| 파일 | 내용 |
|---|---|
| `data/index.json` | 메타 (갱신 시점, 데모 여부) |
| `data/summary.json` | 동 단위 랭킹 요약 (최근 3개월 통계·전년비·거래량·승하차) |
| `data/prices/{시군구코드}.json` | 동·평형구간·단지별 월 집계 (36개월) |
| `data/subway/ridership.json` | 역별 월 일평균 승하차 (전체/평일) |
| `data/ref/regions.json` | 수도권 시군구 코드 |
| `data/ref/station_overrides.json` | 역→법정동 수동 매핑 (직접 추가 가능) |
| `data/ref/station_dong.json` | 최종 역→법정동 매핑 (자동 생성) |

## 알아둘 한계

- **역세권 매칭은 1단계**: 역이 *소재한* 법정동에만 연결합니다. 인접 동은 아직
  반영하지 않습니다. 틀린 매핑을 발견하면 `station_overrides.json`을 고쳐 주세요.
- 지하철 데이터는 교통카드 통계 기반이라 **일부 노선(GTX 등)은 누락**될 수 있습니다.
- 실거래 신고는 계약 후 30일 이내라 **최근 1~2개월 수치는 이후 갱신에서 바뀝니다**
  (최근 3개월은 매 실행 재수집).
- 거래가 적은 동의 중위가는 크게 출렁입니다 — 「최소 거래」 필터를 활용하세요.
