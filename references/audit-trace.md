# MCP監査履歴

Companion Web Agentで支援探索と根拠確認を追跡するときに使用する。

## 記録単位

各イベントに次を含める。

- `id`: 回答内で一意なtraceId
- `actor`: MCP Router、LLM Agent Router、Evidence Checker等
- `action`: ツール発見、MCP実行、根拠照合等
- `target`: MCP名とツール名
- `status`: success、error、skipped、running
- `detail`: 件数、処理時間、エラー要約。APIキーや入力本文は含めない
- `at`: ISO 8601形式の時刻

## 根拠との結合

- MCPツールが正常終了した時だけtraceIdを根拠候補として登録する。
- LLMが返した根拠のtraceIdを、登録済みtraceIdとサーバー側で照合する。
- 未登録traceId、失敗したMCP、LLMだけが生成したURLは確認済み根拠にしない。
- URLはMCPの生出力に同じ文字列が含まれる場合だけ表示する。

## 保存範囲

標準では回答JSON内だけに含め、ディスクへ永続保存しない。永続監査ログを追加する場合は、保存期間、閲覧権限、削除方法、医療・個人情報の最小化を先に定める。
