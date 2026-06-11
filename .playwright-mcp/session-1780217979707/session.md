
### Tool call: browser_navigate
- Args
```json
{
  "url": "https://noxa-delta.vercel.app/account/login"
}
```
- Result
```json
{
  "code": "await page.goto('https://noxa-delta.vercel.app/account/login');",
  "page": "- Page URL: https://noxa-delta.vercel.app/account/login\n- Page Title: NOXA — 夜の街のための統合プラットフォーム",
  "snapshot": "- generic [active] [ref=e1]:\n  - link \"メインコンテンツへスキップ\" [ref=e2] [cursor=pointer]:\n    - /url: \"#main\"\n  - main [ref=e3]:\n    - main [ref=e4]:\n      - generic [ref=e5]:\n        - link \"NOXA\" [ref=e8] [cursor=pointer]:\n          - /url: /\n          - text: \"N\"\n          - emphasis [ref=e9]: O\n          - text: XA\n        - generic [ref=e10]:\n          - heading \"おかえりなさい。 The night is yours, again.\" [level=2] [ref=e11]:\n            - text: おかえりなさい。\n            - text: The night is yours, again.\n          - paragraph [ref=e12]: yorulog, nomishugy, NOXA Community. ひとつの NOXA アカウントで、全てのサービスに。\n        - generic [ref=e13]:\n          - generic [ref=e14]: © 2026 NOXA\n          - generic [ref=e15]: ·\n          - link \"利用規約\" [ref=e16] [cursor=pointer]:\n            - /url: /terms\n          - generic [ref=e17]: ·\n          - link \"プライバシー\" [ref=e18] [cursor=pointer]:\n            - /url: /privacy\n      - generic [ref=e19]:\n        - generic [ref=e20]:\n          - generic [ref=e21]: Sign in\n          - heading \"Welcome back\" [level=1] [ref=e22]\n          - paragraph [ref=e23]: NOXA アカウントでログイン\n        - generic [ref=e24]:\n          - generic [ref=e25]:\n            - generic [ref=e26]: メールアドレス\n            - textbox \"メールアドレス\" [ref=e27]:\n              - /placeholder: you@noxa.app\n          - generic [ref=e28]:\n            - generic [ref=e29]: パスワード\n            - textbox \"パスワード\" [ref=e30]\n            - link \"パスワードを忘れた？\" [ref=e32] [cursor=pointer]:\n              - /url: /account/reset\n          - button \"ログイン\" [ref=e33] [cursor=pointer]\n        - generic [ref=e36]: OR\n        - button \"G Google で続ける\" [ref=e38] [cursor=pointer]:\n          - generic [ref=e39]: G\n          - text: Google で続ける\n        - button \"Apple で続ける\" [ref=e40] [cursor=pointer]: Apple で続ける\n        - paragraph [ref=e42]:\n          - text: アカウントをお持ちでない？\n          - link \"新規登録\" [ref=e43] [cursor=pointer]:\n            - /url: /account/signup\n  - alert [ref=e44]"
}
```

### Tool call: browser_evaluate
- Args
```json
{
  "function": "async () => {\n  const log = [];\n  // 本番 origin (noxa-delta.vercel.app) から exchangeAuthToken に fetch\n  // CORS は ALLOW-ORIGIN: noxa-delta.vercel.app なので通るはず\n  try {\n    const res = await fetch('https://asia-northeast1-noxa-platform.cloudfunctions.net/exchangeAuthToken', {\n      method: 'POST',\n      headers: { 'Authorization': 'Bearer garbage' },\n    });\n    const body = await res.text();\n    log.push({ test: 'prod origin POST', status: res.status, ok: res.ok, body, corsOrigin: res.headers.get('access-control-allow-origin') });\n  } catch (e) {\n    log.push({ test: 'prod origin POST', error: String(e), errorName: e.name, errorMessage: e.message });\n  }\n  // OPTIONS preflight も別途\n  try {\n    const res = await fetch('https://asia-northeast1-noxa-platform.cloudfunctions.net/exchangeAuthToken', {\n      method: 'OPTIONS',\n      headers: { 'Origin': location.origin, 'Access-Control-Request-Method': 'POST' },\n    });\n    log.push({ test: 'prod origin OPTIONS', status: res.status, ok: res.ok, headers: {\n      'access-control-allow-origin': res.headers.get('access-control-allow-origin'),\n      'access-control-allow-methods': res.headers.get('access-control-allow-methods'),\n      'access-control-allow-headers': res.headers.get('access-control-allow-headers'),\n    }});\n  } catch (e) {\n    log.push({ test: 'prod origin OPTIONS', error: String(e) });\n  }\n  return log;\n}"
}
```
- Result
```json
{
  "result": "[\n  {\n    \"test\": \"prod origin POST\",\n    \"status\": 401,\n    \"ok\": false,\n    \"body\": \"{\\\"error\\\":\\\"UNAUTHORIZED\\\"}\",\n    \"corsOrigin\": null\n  },\n  {\n    \"test\": \"prod origin OPTIONS\",\n    \"status\": 204,\n    \"ok\": true,\n    \"headers\": {\n      \"access-control-allow-origin\": null,\n      \"access-control-allow-methods\": null,\n      \"access-control-allow-headers\": null\n    }\n  }\n]",
  "code": "await page.evaluate('async () => {\\n  const log = [];\\n  // 本番 origin (noxa-delta.vercel.app) から exchangeAuthToken に fetch\\n  // CORS は ALLOW-ORIGIN: noxa-delta.vercel.app なので通るはず\\n  try {\\n    const res = await fetch(\\'https://asia-northeast1-noxa-platform.cloudfunctions.net/exchangeAuthToken\\', {\\n      method: \\'POST\\',\\n      headers: { \\'Authorization\\': \\'Bearer garbage\\' },\\n    });\\n    const body = await res.text();\\n    log.push({ test: \\'prod origin POST\\', status: res.status, ok: res.ok, body, corsOrigin: res.headers.get(\\'access-control-allow-origin\\') });\\n  } catch (e) {\\n    log.push({ test: \\'prod origin POST\\', error: String(e), errorName: e.name, errorMessage: e.message });\\n  }\\n  // OPTIONS preflight も別途\\n  try {\\n    const res = await fetch(\\'https://asia-northeast1-noxa-platform.cloudfunctions.net/exchangeAuthToken\\', {\\n      method: \\'OPTIONS\\',\\n      headers: { \\'Origin\\': location.origin, \\'Access-Control-Request-Method\\': \\'POST\\' },\\n    });\\n    log.push({ test: \\'prod origin OPTIONS\\', status: res.status, ok: res.ok, headers: {\\n      \\'access-control-allow-origin\\': res.headers.get(\\'access-control-allow-origin\\'),\\n      \\'access-control-allow-methods\\': res.headers.get(\\'access-control-allow-methods\\'),\\n      \\'access-control-allow-headers\\': res.headers.get(\\'access-control-allow-headers\\'),\\n    }});\\n  } catch (e) {\\n    log.push({ test: \\'prod origin OPTIONS\\', error: String(e) });\\n  }\\n  return log;\\n}');",
  "page": "- Page URL: https://noxa-delta.vercel.app/account/login\n- Page Title: NOXA — 夜の街のための統合プラットフォーム\n- Console: 4 errors, 0 warnings",
  "events": "- New console entries: .playwright-mcp\\console-2026-05-31T08-59-39-712Z.log#L1-L5"
}
```
