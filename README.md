# Japan Mental Health Navigator

状況を整理し、支援候補・不足情報・確認先・次の行動・問い合わせ文案を作るReact製AI Agentです。AIはOrcaRouter経由で呼び出し、APIキーはブラウザへ渡しません。問い合わせ文案は、人が宛先・件名・本文を確認した後、ログイン中のGmail作成画面へ引き渡せます。

## GitHubから利用する場合

このリポジトリには、APIキー、`node_modules`、Python仮想環境、OpenFace本体・モデル、ビルド生成物を含めていません。これらは利用者のPCで再構築します。

### 必要なもの

- Windows 10または11（64bit）
- [Node.js LTS](https://nodejs.org/)
- [Python 3.11（64bit）](https://www.python.org/downloads/release/python-3119/)（インストール時にPython Launcherも有効にしてください）
- [OrcaRouter](https://orcarouter.com/)のAPIキー
- OpenFace 2は任意です。未導入でもブラウザ内のMediaPipeで基本的な顔観察を実行できます。

### セットアップ

1. GitHubからこのリポジトリをダウンロードまたはcloneします。
2. `setup.cmd` をダブルクリックします。
3. Node.js依存関係、Python仮想環境、OpenFisca Japan MCPが自動的に準備されます。
4. 自動作成された `.env` をメモ帳で開き、`ORCAROUTER_API_KEY=` の右側へ自分のAPIキーを入力します。
5. 必要に応じて `ESTAT_APP_ID=` も設定します。
6. `start.cmd` をダブルクリックして起動します。

PowerShellでnpmスクリプトが禁止されているPCでも、セットアップは `npm.cmd` を使うため、通常はExecution Policyの恒久変更は不要です。

### GitHubに含めないもの

| 対象 | 理由 | 復元方法 |
|---|---|---|
| `.env` | APIキーを含む | `.env.example`から作成（`setup.cmd`が自動作成） |
| `node_modules/` | 再生成でき、容量が大きい | `setup.cmd`または`npm.cmd install --ignore-scripts` |
| `.runtime/` | Python環境・OpenFaceなどが大きい | `setup.cmd`と下記OpenFace手順 |
| `dist/` | ビルド生成物 | `npm.cmd run build` |
| `.npm-cache/` | 一時キャッシュ | npmが必要に応じて再作成 |

## 初回設定

1. `.env` の `ORCAROUTER_API_KEY=` の右側へOrcaRouterのキーを貼り付けます。
   `ORCAROUTER_ROUTER_MODEL` が通常の自由記述の一次整理、`ORCAROUTER_HYPOTHESIS_MODEL` が顔観察と自由記述から複数仮説・確認質問を作るモデルです。標準値は `orcarouter/auto` で、OrcaRouterがリクエストごとに品質・費用・稼働状況を評価してモデルを選びます。`ORCAROUTER_MODEL_LOW` / `MEDIUM` / `HIGH` は難易度別の最終回答モデルです。`ORCAROUTER_FALLBACK_MODELS` はタイムアウト時の代替モデルで、複数指定するときはカンマで区切ります。

   画像はブラウザ側で最大辺1280pxのJPEGへ縮小され、MediaPipe Face Landmarkerと、利用可能な場合はPC内のOpenFace 2で処理されます。OpenFaceはAction Unit、視線、頭部姿勢を観察し、一時画像とCSVは処理直後に削除します。標準では顔画像そのものを外部送信せず、観察文と係数だけをOrcaRouterへ送ります。画像選択後に「顔画像をOrcaRouter経由の画像対応AIへ送信する」を本人がオンにした場合だけ、元画像も一次整理モデルへ送信します。元画像はMCPや制度探索へ渡しません。OrcaRouterは精神状態の低確信度の仮説と本人への確認質問を作りますが、顔観察だけから診断、危険性、制度資格を決めません。画像と相談内容はアプリ側へ保存しません。

   `skills/mental-state-support/SKILL.md` は、本人申告・生活への影響・利用できる支え・安全確認・不足情報を非診断的に整理する実行時Skillです。一次整理モデルが毎回このSkillを読み、支援上の優先度とケース難易度を返します。正式な質問への回答がない状態でPHQ-9、GAD-7、K6、C-SSRS等を推定採点することはありません。
2. e-Gov MCPは同梱済みで、APIキーなしで自動起動します。
3. OpenFiscaは `setup.cmd` が作成するPython 3.11専用環境から自動起動します。LocalGov MCPも同梱されており、LocalGov.jpの公開APIを使って自治体を含む補助制度を検索します。外部のLocalGov MCPを使う場合だけ `.env` の `MCP_LOCALGOV_URL` で上書きできます。
4. e-Statを使う場合だけ `ESTAT_APP_ID` を設定します。内蔵e-Stat MCPが自動起動します。e-Statは地域統計の補助に使い、個人の制度資格判定には使いません。
5. `setup.cmd` を使わず手動設定する場合は、このフォルダーで `npm.cmd install --ignore-scripts` を一度実行します。

### OpenFace 2（任意）

OpenFaceはリポジトリに同梱しません。[OpenFaceのWindows向け公式手順](https://github.com/TadasBaltrusaitis/OpenFace/wiki/Windows-Installation)に従ってWindows版と必要モデルを取得してください。

導入方法は次のどちらかです。

1. OpenFace 2.2.0を `.runtime/openface-2.2.0/` 以下へ配置する。
2. 任意の場所へ配置し、`.env` の `OPENFACE_FEATURE_EXTRACTION_PATH` に `FeatureExtraction.exe` の絶対パスを設定する。

OpenFaceがない場合でもMediaPipeだけで動作します。OpenFace本体やモデルを再配布する場合は、必ず公式ライセンスとモデルの利用条件を確認してください。

## 起動

`start.cmd` をダブルクリックします。OpenFisca MCP、Agent API、React画面がまとめて起動します。

- 画面: http://127.0.0.1:5174/
- Agent API: http://127.0.0.1:8787/api/health
- OpenFisca MCP: http://127.0.0.1:8791/mcp

OrcaRouterは通常モデルを20秒待ち、失敗時は高速なGemini Flash Lite、最後に自動ルーターへ切り替えます。代替モデルは各45秒待ちます。認証エラーでは再試行しません。試行したモデルと成否は画面の「誰が何をしたか」に残ります。

MCPツール呼び出しは複数あれば並列実行し、1ツール20秒で打ち切って他の根拠で処理を続けます。e-Statは個人の資格判定には通常使用せず、統計・人口・割合・推移などを明示的に質問した場合だけAIへ提示します。

MCP探索は最大2巡です。1巡目で候補を検索し、2巡目で必要な詳細を取得した後は、未確認事項を明示して最終回答へ進みます。

LocalGovは自治体補助制度の候補探索用です。医療・福祉相談窓口の完全な一覧ではないため、取得結果の `source_url` と自治体公式ページで対象条件・連絡先・受付状況を最終確認します。構造化データは「via LocalGov.jp」と出典表示します。

画面の入力方法は変えず、送信後に自由記述を「健康・症状」「通院・治療」「就労・休職」「収入・支出・資産」「世帯・家族」「居住地」「制度・保険」「希望・相談目的」へローカルで構造化します。不足情報と緊急性も事前検出し、その要因に必要なMCPだけをAIへ提示します。この構造化処理ではOrcaRouterを追加呼び出ししません。

回答後に不足情報がある場合は「一問ずつ、追加情報を補う」ナビが表示されます。答えたくない質問はスキップでき、回答した項目だけを元の相談内容へ追記して支援候補を再評価します。質問は制度探索に必要な1〜3件を優先し、診断や詳細なトラウマ開示には使いません。

終了するときは、起動した黒い画面で `Ctrl+C` を押します。

## 安全設計

- 診断、治療判断、制度資格、給付額を確定しません。
- 顔画像の外部送信は標準で無効です。MediaPipeとOpenFace 2はPC内処理で、OpenFace用の一時ファイルは処理直後に削除します。本人が画面上で許可した場合だけ一次整理モデルへ元画像を送り、MCPには渡しません。静止画の仮説は常に「確信度：低・本人確認が必要」と表示します。
- MCPで根拠を取得できない候補は「要確認」に固定します。
- 成功したMCP呼び出しのtraceIdと一致する根拠だけを確認済みとして扱います。
- 画面の「誰が何をしたか」で、ツール発見、MCP実行、成否、根拠照合を確認できます。
- Gmailへ渡す前に、宛先・件名・本文・個人情報の人による確認を必須にします。
- Agentはメールを自動送信しません。Gmailの作成画面を開き、最終送信は本人が行います。
- 緊急性が検出された場合はメール連携を停止し、安全案内を優先します。
