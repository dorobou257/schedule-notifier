# 노션 중계 워커

PWA(정적 사이트)가 노션을 읽고 쓸 수 있게 해주는 Cloudflare Worker.
자세한 배경은 `src/index.js` 상단 주석 참고.

## 배포

Cloudflare 무료 계정이 필요하다(카드 등록 불필요). 이 디렉터리에서 순서대로:

```bash
npx wrangler login
```

```bash
npx wrangler deploy
```

```bash
npx wrangler secret put NOTION_TOKEN
```

시크릿을 먼저 넣으면 "그런 워커가 없는데 만들까요?"를 되묻는다. 워커를
먼저 만들어두고 시크릿을 넣는 편이 헷갈리지 않는다. 시크릿은 넣는 즉시
반영되므로 다시 배포할 필요는 없다(첫 배포와 시크릿 사이에는 /today가
500을 낸다 — 정상이다).

배포가 끝나면 `https://schedule-notion.<계정>.workers.dev` 같은 주소가 나온다.
그 주소를 `docs/config.js`의 `WORKER_URL`에 넣고 커밋하면 앱이 워커를 쓰기 시작한다.
비워두면 앱은 예전처럼 `today.json`만 읽고, 체크는 이 기기에만 남는다.

## 미리 확인할 것

- 노션 [일정]/[소설] DB에 **"완료"** 체크박스 속성이 있어야 한다.
- 노션 Integration 권한이 **읽기 + 콘텐츠 업데이트**여야 하고, 두 DB에 연결되어 있어야 한다.

## 로컬 확인

```bash
npx wrangler dev
```

```bash
curl "http://localhost:8787/today"
```

```bash
curl -X PATCH http://localhost:8787/item -H "Content-Type: application/json" -d "{\"id\":\"<페이지id>\",\"done\":true}"
```

우리 DB에 없는 페이지 id로 PATCH하면 403이 떠야 정상이다.
