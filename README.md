# 일정 알리미

매일 08:00(KST)에 노션의 [일정] / [소설] 캘린더를 확인해서 하나의 이메일로 정리해 보내는 자동화입니다.

## 폴더 구성
- `notify.py` : 매일 실행되는 메인 스크립트
- `update_holidays.py` : 매년 초 1회, 대한민국 공휴일을 노션에 채워 넣는 스크립트
- `.github/workflows/daily-notify.yml` : 매일 08시 실행 스케줄러
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

### 3. Gmail 앱 비밀번호 발급
1. 구글 계정 → 보안 → 2단계 인증 켜기 (필수)
2. "앱 비밀번호" 생성 → 16자리 값이 `GMAIL_APP_PASSWORD`
3. 보내는 사람 주소가 `GMAIL_ADDRESS`, 받는 사람(본인) 주소가 `MAIL_TO`

### 4. 공공데이터포털 공휴일 API 키 (공휴일 자동화용)
1. https://www.data.go.kr/data/15012690/openapi.do 에서 활용신청
2. 승인 후 마이페이지에서 서비스키(디코딩된 값) 확인 → `HOLIDAY_API_KEY`

### 5. GitHub 저장소 설정
1. 이 폴더를 새 GitHub 저장소에 push
2. 저장소 → Settings → Secrets and variables → Actions → New repository secret 으로 아래 7개 등록:
   `NOTION_TOKEN`, `SCHEDULE_DB_ID`, `NOVEL_DB_ID`, `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD`, `MAIL_TO`, `HOLIDAY_API_KEY`
3. Actions 탭에서 워크플로우가 활성화되어 있는지 확인 (기본적으로 자동 활성화됨)
4. 바로 테스트해보고 싶으면 Actions 탭 → 해당 워크플로우 → "Run workflow" 버튼으로 수동 실행 가능

## 참고
- 2026년 8~12월 공휴일 9건은 이미 노션에 수동으로 입력해뒀습니다. `update_holidays.py`는 2027년부터 자동으로 채워줍니다.
- "종류" 속성이 "일정"이면 루틴 대신 그 일정이 전송되고, "할일" 또는 "과제"면 루틴(또는 일정)과 결합되어 전송됩니다.
- 루틴 중 21~22시는 월/수/금엔 "운동", 화/목/토/일엔 "3차 작업"으로 자동 대체됩니다.
