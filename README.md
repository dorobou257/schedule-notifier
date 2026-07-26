# 일정 알리미

노션의 [일정] / [소설] 캘린더를 매일 기상 시간(평일 8시 / 주말 9시)에 확인해서, 폰에 설치한 앱(PWA)에 오늘 일정을 띄워주고, 오늘 할일/소설 일정을 요약해 ntfy.sh로 푸시 알림 한 번 보내는 자동화입니다. 이메일은 쓰지 않습니다.

## 폴더 구성
- `notify.py` : 매일 기상 시간(평일 8시 / 주말 9시)에 실행되어 노션을 읽고 `docs/today.json`을 갱신하며, 오늘 하루 요약을 ntfy.sh로 한 번 보내는 메인 스크립트
- `update_holidays.py` : 매년 초 1회, 파이썬 `holidays` 라이브러리로 대한민국 공휴일을 계산해 노션에 채워 넣는 스크립트 (별도 API 키 불필요)
- `docs/` : GitHub Pages로 서비스되는 PWA(휴대폰에 설치하는 앱) 소스
  - `index.html` : `today.json`을 읽어서 화면에 보여주는 앱 본체 (푸시 알림은 이 PWA가 아니라 별도의 ntfy 앱이 수신함)
  - `manifest.json`, `service-worker.js`, `icon-*.png` : 홈 화면 설치 + 오프라인 캐싱을 위한 PWA 필수 파일
  - `today.json` : `notify.py`가 매일 아침 자동으로 덮어쓰는 "오늘 일정" 데이터 (오늘 알림을 이미 보냈는지 여부 포함)
- `.github/workflows/daily-notify.yml` : 매일 기상 시간(평일 8시 / 주말 9시)에 외부 크론이 깨우는 워크플로우 (화면 갱신 + 알림 발송 + Pages 배포)
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
2. 저장소 → Settings → Secrets and variables → Actions → New repository secret 으로 아래 4개 등록:
   `NOTION_TOKEN`, `SCHEDULE_DB_ID`, `NOVEL_DB_ID`, `NTFY_TOPIC`
   (`NTFY_TOPIC` 값은 아래 6번에서 정함)
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

### 6. ntfy.sh 푸시 알림 설정
OneSignal(Web Push)에서 ntfy.sh로 바꿨습니다. 안드로이드 Chrome의 Web Push 구독이
서비스워커가 갱신되거나 배터리 최적화로 브라우저가 백그라운드에서 종료될 때마다
몇 시간 만에 조용히 끊기는 문제가 반복돼서(구독 기록에 "Unsubscribed"가 계속
쌓이는 걸 확인함), 별도 네이티브 앱(FCM 기반)으로 수신하는 ntfy로 옮겼습니다.

1. 추측 불가능한 랜덤 문자열로 토픽 이름을 하나 정합니다 (ntfy.sh는 공개 서버라
   토픽 이름을 아는 사람은 누구나 구독·발행할 수 있으므로 이게 사실상의 비밀키
   역할을 합니다). 예: `schedule-<랜덤 문자열>`
2. 휴대폰에 [ntfy 앱](https://ntfy.sh/) 설치 (Android: Play Store, iOS: App Store)
3. 앱에서 **+** 버튼 → 1번에서 정한 토픽 이름으로 구독 추가
4. GitHub Secrets에 `NTFY_TOPIC`으로 그 토픽 이름을 등록
5. 알림 도착 확인: `curl -d "테스트 메시지" https://ntfy.sh/<토픽 이름>` 실행 후 휴대폰에 알림이 뜨는지 확인
6. (선택) ntfy 앱 설정에서 배터리 최적화 예외를 걸어두면 백그라운드 수신이 더 안정적입니다

OneSignal과 달리 ntfy는 "수신자 0명"을 알려주지 않는 단순 발행-구독 방식이라, 발송
자체(HTTP 요청)가 성공했는지만 확인할 수 있고 실제로 휴대폰이 받았는지는 코드로
검증할 수 없습니다. 알림이 하루 지나도 안 오면 5번처럼 `curl`로 직접 발행해보고
휴대폰에 뜨는지부터 확인하세요.

### 7. daily-notify를 기상 시간에 깨우기 (외부 크론)
`daily-notify.yml`에는 GitHub 자체 `schedule` 트리거를 빼뒀습니다. GitHub의 예약 실행은 지연/누락이 잦아서, 대신 무료 외부 크론 서비스가 GitHub API를 직접 호출해 깨우는 방식을 씁니다. (Public 저장소라 GitHub Actions 실행 시간은 무료·무제한입니다.)

기상 시간이 평일 8시 / 주말 9시로 나뉘므로, cron-job.org에 **같은 내용의 크론잡을 2개** 만들어야 합니다 (URL·Method·Headers·Body는 완전히 동일하고 요일·시각만 다름).

1. GitHub → 우측 상단 프로필 → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
   - Repository access: **Only select repositories** → `schedule-notifier`만 선택
   - Permissions → **Actions**: **Read and write**
   - 생성된 토큰(`github_pat_...`)을 복사해둡니다 (다시 볼 수 없으니 주의)
2. https://cron-job.org 에서 무료 가입 후 **Create cronjob**을 두 번 반복:
   - URL: `https://api.github.com/repos/dorobou257/schedule-notifier/actions/workflows/daily-notify.yml/dispatches`
   - Request method: `POST`
   - Headers 추가:
     - `Authorization: Bearer <위에서 발급받은 토큰>`
     - `Accept: application/vnd.github+json`
     - `Content-Type: application/json`
   - Request body: `{"ref":"master"}`
   - 크론잡 A(평일): Schedule **월~금 08:00**, `Asia/Seoul` 시간대
   - 크론잡 B(주말): Schedule **토~일 09:00**, `Asia/Seoul` 시간대
3. 저장 후 각 크론잡에서 "Run now"로 한 번씩 테스트 → GitHub Actions 탭에 `daily-notify`가 `workflow_dispatch`로 즉시 실행되면 성공

## 참고
- 2026년 8~12월 공휴일 9건은 이미 노션에 수동으로 입력해뒀습니다. `update_holidays.py`는 2027년부터 자동으로 채워줍니다.
- "종류" 속성이 "일정"이면 루틴 대신 그 일정이 표시되고, "할일" 또는 "과제"면 루틴(또는 일정)과 결합되어 표시됩니다.
- 루틴은 평일(월~금, 집필 4블록)과 주말(토~일, 작업 2블록 + 구상)로 나뉩니다. 월/수/금 저녁엔 운동이 들어가고 화/목은 그만큼 작업 시간이 늘어나며, 금요일 밤과 일요일 밤은 다음날 기상 시각에 맞춰 취침 시각이 각각 늦춰지고/당겨집니다. 정확한 구성은 `notify.py`의 `build_routine_items` 참고.
- **알림은 하루에 한 번, 기상 시간(평일 8시 / 주말 9시)에만 갑니다.** 화면(PWA)에 보이는 오늘 일정 전체를 실시간으로 계속 갱신하던 예전 방식(5분 간격)에서, 기상 시간에 한 번 요약 알림만 보내는 방식으로 바꿨습니다. 루틴 일정(기상/집필/작업/식사 등)은 매일 똑같아서 알림 내용에는 안 넣고, 그날그날 달라지는 공휴일·특별 일정·할일·소설 항목만 알림에 넣습니다.
- 화면(PWA)도 같은 시점(기상 시간)에 한 번만 갱신됩니다. 그 이후 노션에 새로 추가한 항목은 다음날 실행 전까지는 화면에 안 뜹니다.
- 이미 그날 알림을 보냈으면(`today.json`의 `notified` 값) 같은 날 다시 실행돼도 중복으로 안 보냅니다.
