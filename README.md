# 일정 알리미

매일 08:00(KST)에 노션의 [일정] / [소설] 캘린더를 확인해서, 폰에 설치한 앱(PWA)에 오늘 일정을 띄워주는 자동화입니다. 이메일은 쓰지 않습니다.

## 폴더 구성
- `notify.py` : 매일 실행되어 노션을 읽고 `docs/today.json`을 갱신하는 메인 스크립트
- `update_holidays.py` : 매년 초 1회, 파이썬 `holidays` 라이브러리로 대한민국 공휴일을 계산해 노션에 채워 넣는 스크립트 (별도 API 키 불필요)
- `docs/` : GitHub Pages로 서비스되는 PWA(휴대폰에 설치하는 앱) 소스
  - `index.html` : `today.json`을 읽어서 화면에 보여주는 앱 본체
  - `manifest.json`, `service-worker.js`, `icon-*.png` : 홈 화면 설치를 위한 PWA 필수 파일
  - `today.json` : `notify.py`가 매일 자동으로 덮어쓰는 "오늘 일정" 데이터
- `.github/workflows/daily-notify.yml` : 매일 08시에 외부 크론이 깨우는 워크플로우
- `.github/workflows/yearly-holidays.yml` : 매년 1월 초 실행 스케줄러

## 준비 단계

### 1. 노션 Integration 토큰 발급
1. https://www.notion.so/my-integrations 에서 새 Integration 생성 (이름 아무거나)
2. "Internal Integration Secret" 복사 → 이게 `NOTION_TOKEN`
3. 노션에서 [일정] 페이지, [소설] 페이지 각각 우측 상단 `...` → `연결 추가` → 방금 만든 Integration 선택 (공유해줘야 API로 읽을 수 있습니다)

### 2. 데이터베이스 ID 확인
이미 다음 두 ID를 확인해뒀습니다.
- `SCHEDULE_DB_ID` = `15825ba2c8ef807b8e29dbe1e2491b2b` ([일정])
- `NOVEL_DB_ID` = `21a25ba2c8ef808e97b9cf996c3347be` ([소설])

### 3. GitHub 저장소 설정
1. 이 폴더를 새 GitHub 저장소에 push
2. 저장소 → Settings → Secrets and variables → Actions → New repository secret 으로 아래 3개 등록:
   `NOTION_TOKEN`, `SCHEDULE_DB_ID`, `NOVEL_DB_ID`
3. Actions 탭에서 워크플로우가 활성화되어 있는지 확인 (기본적으로 자동 활성화됨)
4. 바로 테스트해보고 싶으면 Actions 탭 → 해당 워크플로우 → "Run workflow" 버튼으로 수동 실행 가능

### 4. GitHub Pages 활성화 (PWA 배포)
1. 저장소 → **Settings → Pages**
2. **Build and deployment → Source**: `Deploy from a branch`
3. **Branch**: `master` / `docs` 폴더 선택 → **Save**
4. 잠시 후 `https://<사용자명>.github.io/<저장소명>/` 주소로 접속되면 성공

### 5. 휴대폰에 앱으로 설치하기
1. 안드로이드 Chrome에서 위 GitHub Pages 주소로 접속
2. 우측 상단 메뉴(⋮) → **"앱 설치"** 또는 **"홈 화면에 추가"**
3. 홈 화면에 생긴 아이콘을 누르면 브라우저 주소창 없이 앱처럼 열림

### 6. daily-notify를 매일 08:00(KST)에 깨우기 (외부 크론)
`daily-notify.yml`에는 GitHub 자체 `schedule` 트리거를 빼뒀습니다. GitHub의 정시(00분) 예약 실행은 지연/누락이 잦아서, 대신 무료 외부 크론 서비스가 GitHub API를 직접 호출해 깨우는 방식을 씁니다.

1. GitHub → 우측 상단 프로필 → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
   - Repository access: **Only select repositories** → `schedule-notifier`만 선택
   - Permissions → **Actions**: **Read and write**
   - 생성된 토큰(`github_pat_...`)을 복사해둡니다 (다시 볼 수 없으니 주의)
2. https://cron-job.org 에서 무료 가입 후 **Create cronjob**
   - URL: `https://api.github.com/repos/dorobou257/schedule-notifier/actions/workflows/daily-notify.yml/dispatches`
   - Request method: `POST`
   - Headers 추가:
     - `Authorization: Bearer <위에서 발급받은 토큰>`
     - `Accept: application/vnd.github+json`
     - `Content-Type: application/json`
   - Request body: `{"ref":"master"}`
   - Schedule: 매일, `Asia/Seoul` 시간대로 `08:00`
3. 저장 후 cron-job.org에서 "Run now"로 한 번 테스트 → GitHub Actions 탭에 `daily-notify`가 `workflow_dispatch`로 즉시 실행되면 성공

## 참고
- 2026년 8~12월 공휴일 9건은 이미 노션에 수동으로 입력해뒀습니다. `update_holidays.py`는 2027년부터 자동으로 채워줍니다.
- "종류" 속성이 "일정"이면 루틴 대신 그 일정이 표시되고, "할일" 또는 "과제"면 루틴(또는 일정)과 결합되어 표시됩니다.
- 루틴 중 21~22시는 월/수/금엔 "운동", 화/목/토/일엔 "3차 작업"으로 자동 대체됩니다.
- 지금은 앱을 직접 열어야 오늘 일정이 보입니다. 아침에 폰으로 알림이 오는 기능(푸시 알림)은 다음 단계에서 추가할 예정입니다.
