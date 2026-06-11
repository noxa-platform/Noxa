# iOS（yorulog-ios / SwiftUI）への依頼プロンプト — LINE ログイン実装

> このまま yorulog-ios の Claude セッションに貼ってください。バックエンド（noxa）側は実装・デプロイ済みです。

---

## ゴール
yorulog-ios（SwiftUI / Firebase Auth、プロジェクト `noxa-platform`）に **「LINEでログイン」** を追加する。
LINE SDK で取得したトークンを noxa の Cloud Function に渡し、返ってきた **Firebase Custom Token** で `signInWithCustomToken` する。Web 版は実装済みで、同じ Firebase ユーザー体系（1ユーザー=1アカウント）に乗る。

## 使えるバックエンド（実装済み・デプロイ済み）
- **エンドポイント**: `POST https://asia-northeast1-noxa-platform.cloudfunctions.net/lineLogin`
- **リクエスト（iOS 推奨）**: JSON `{ "accessToken": "<LINEアクセストークン>" }`
  - 代替: `{ "idToken": "<LINE IDトークン(JWT文字列)>" }`（取得できる場合。email スコープ承認後はメールも取れる）
- **レスポンス**: `{ "customToken": "<Firebase Custom Token>" }`
- **エラー**: 400 `BAD_REQUEST` / 401 `PROFILE_FAILED`・`VERIFY_FAILED`・`NO_SUBJECT` / 500 `NOT_CONFIGURED`・`INTERNAL`
- サーバが LINE プロフィール（userId / displayName / pictureUrl、idToken 時は email も）を取得 → Firebase ユーザーを作成/更新（uid=`line_<lineUserId>`、email 一致時は既存統合）→ Custom Token を発行する。**Channel Secret はサーバのみ保持**（アプリに埋め込まない）。

## LINE チャネル情報（作成・公開済み）
- **Channel ID（公開値）**: `2010310730`
- 種別: LINEログイン / ステータス: **公開済み**
- 取得スコープ: `profile`, `openid`（`email` は LINE のメール取得権限が審査制のため未取得。承認後に `.email` 追加）

## 実装手順（iOS）

### 1. LINE SDK 追加
- Swift Package Manager で `https://github.com/line/line-sdk-ios-swift`（`LineSDK`）を追加。

### 2. Info.plist
- `LineSDKConfig`（Dictionary）→ `ChannelID`（String）= `2010310730`
- `CFBundleURLTypes` に URL スキーム `line3rdp.$(PRODUCT_BUNDLE_IDENTIFIER)` を追加
- `LSApplicationQueriesSchemes`（Array）に `lineauth2` を追加

### 3. SDK セットアップ（アプリ起動時）
```swift
import LineSDK
// App 起動時（@main の init / AppDelegate.didFinishLaunching 等）
LoginManager.shared.setup(channelID: "2010310730", universalLinkURL: nil)
```
SwiftUI ならルート View に:
```swift
.onOpenURL { url in _ = LoginManager.shared.application(.shared, open: url) }
```

### 4. ログインボタンの処理
```swift
import LineSDK
import FirebaseAuth

func loginWithLine() {
    LoginManager.shared.login(permissions: [.profile, .openID], in: nil) { result in
        switch result {
        case .success(let value):
            let accessToken = value.accessToken.value   // ← これをサーバへ
            Task { await exchangeForFirebase(accessToken: accessToken) }
        case .failure(let error):
            print("LINE login failed:", error)
        }
    }
}

func exchangeForFirebase(accessToken: String) async {
    guard let url = URL(string: "https://asia-northeast1-noxa-platform.cloudfunctions.net/lineLogin") else { return }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: ["accessToken": accessToken])
    do {
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let customToken = json["customToken"] as? String else { return }
        try await Auth.auth().signIn(withCustomToken: customToken)
        // 既存のログイン後遷移と同じ導線へ
    } catch { print("exchange failed:", error) }
}
```

### 5. 既存処理との整合
- このアプリの既存 Firebase Auth サインイン（Apple/メール等）と同じ「ログイン後の状態管理・画面遷移」に合流させること。
- 既存の認証・ネットワーク層のスタイルに合わせる。**勝手な大規模リファクタ禁止**。
- `account_users/{uid}` の upsert はサーバ側 lineLogin が Firebase ユーザーの基本プロフィール（displayName/photoURL）を設定する。アプリ側で追加の初期化が必要なら既存のサインイン後フローに準拠。

## ⚠️ このセッションで必ず確認・連絡してほしいこと
1. **iOS の Bundle Identifier** を教えてください。LINE Login チャネルの「LINEログイン設定 → iOSのバンドルID」に登録が必要です（未登録だと SDK ログインが弾かれます）。登録は noxa 側セッションが Playwright で行えます。**Bundle ID を回答してください。**
2. Universal Link を使う場合はその URL も（使わないなら `universalLinkURL: nil` のままで可）。
3. email を使ったアカウント統合は、LINE の「メールアドレス取得権限」審査が通ってから有効化（その際 `.email` を `permissions` に追加し、サーバは idToken 経由になる）。現状は `line_<userId>` で個別アカウント作成。

## やってはいけないこと
- Channel Secret をアプリに埋め込まない（サーバのみ）。
- noxa リポ / Web 側のコードはこのセッションでは触らない（バックエンドは実装済み）。
