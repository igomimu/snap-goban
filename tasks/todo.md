# 2026-08-11 配置・手順モードの2ボタン化

- [x] 黒石配置・白石配置ボタンを1つにまとめる
- [x] 配置ボタンの再押下で黒石／白石を切り替える
- [x] 選択中の色を左クリックで配置する
- [x] production buildで検証する
- [x] commit・pushを行う

## Review

- 配置用の黒石・白石ボタンを1つに統合し、選択中に再度押すと色が切り替わるようにした。
- 配置モードの左クリックは、ボタンに表示中の色を置く。既存配置石のクリックは従来どおり削除する。
- 手順用の「1」入り石ボタンと合わせ、入力モードを2ボタンに統一した。
- `npm run build` と `git diff --check` が成功した。
- commit `b629a01` をorigin/masterへpushした。

# 2026-10-24 改行を含むSGFの配置欠落

- [x] 77.sgfの原本と読み込み処理を確認し、原因と正しい配置数を特定
- [x] ルートのAB/AWを改行・空白・繰り返しに対応させ、既存変更を保全
- [x] 原本相当の再現データ・回帰テスト・ビルド・画面表示で検証
- [x] 拡張機能を更新し、今回の差分だけcommit/pushしてGitHub反映を確認

## Review（2026-10-24）

- MultiGoの改行入り配置リストと同一ルート内の追加ABを取りこぼしていた。修正前は黒16・白13、修正後は原本どおり黒64・白48。
- ルート限定でプロパティを読むことで、後続ノードの配置やコメント内のAB表記を初期配置へ混ぜない。
- `node scripts/test-sgf-setup.cjs`で改行・空白・追加AB・コメント・分岐・33手とパス3回を検証。修正前のコードでは同テストが失敗することも確認。
- `node scripts/test-numbering.cjs`、`npm run build`が成功。別担当の読み取り専用レビューで指摘なし。
- Chromiumの独立した検証用プロファイルで実際にdistを拡張機能として読み込み、ファイル選択から黒64・白48、v3.0.15、実行時エラーなしを確認。
- 原本77.sgfのSHA256は作業前後で同一。既存の番号再開始機能などの未コミット変更は今回のcommitに含めない。
- `scripts/update_extension.ps1`を実行し、manifestと画面のバージョンを3.0.15へ更新。利用中ブラウザでの拡張機能再読み込みは未確認。

# 2026-10-30 Wordに貼って保存すると盤が黒くなる（白黒反転）

- [x] 三村さんのWordファイルから原因を特定（クリック用 `fill="transparent"` の rect 81個が保存時に #000000 へ）
- [x] クリック用 rect を書き出しから除外＋書き出し時の transparent を none に
- [x] 修正前後のSVGをLEGIONのWordで 挿入→保存→開き直し→PDF 比較
- [x] v3.0.16 で commit/push、ストア提出用zipをDriveへ

## Review（2026-10-30・LEGION）

- 再現: SGF(9路)を貼り付け→Ctrl+F(SVG)。修正前のSVGは transparent の rect 81個、修正後は0個
- Word(Microsoft 365 16.0.20527)で修正前は盤全体が黒く覆われ白石だけが見える／修正後は正常
- commit `c6e07fc`。zip: Drive `Snap_Goban_v3.0.16.zip`（id 13UjThGco4QYo8ST40zMK-Bfs8KbihSxQ）
- YOGAProの開発版で三村さんが確認: snap-gobanのSVGで貼った図（右上・手順番号と凡例入り）が保存→開き直しても黒く塗りつぶされない（2026-10-30）
- 残り: Chrome Web Storeへの提出（三村さん）

# 2026-10-30 WordへのSVGをGoWriteの見た目に（v3.0.17）

- 三村さんがGoWriteの図と並べた比較: snap-gobanは盤端が細い・罫線が薄い・背景の薄い箱が見える
- 書き出しで non-scaling-stroke を外し、罫線1.6・盤端5（1路=40）。白黒は背景なし、凡例の下の覆いは純白
- LEGIONのWordで v3.0.16 と比較（凡例付き9路・保存→開き直し→PDF）。commit `103fb87`
- zip: Drive `Snap_Goban_v3.0.17.zip`（v3.0.18で置き換え）

# 2026-10-30 凡例をGoWriteの書き方に（v3.0.18）

- 手本: 三村さんの `今日の問題.docx`（同じ局面のGoWrite図とsnap-goban図）、GoWriteの解答図EMF（攻め合いの達人・勝利は細部に宿る）
- 中央寄せ・最後の線から約1.1路・石は盤上と同じ大きさ・角括弧は石と同じ高さの細字・数字は細字（Word向けSVG）
- LEGIONのWordで凡例2項目の9路を 挿入→保存→開き直し→PDF で確認。commit `c079636`、zip: Drive `Snap_Goban_v3.0.18.zip`
- v3.0.19: 三村さん決定でWord用SVGだけ石を隣と接する大きさ（半径19.5）に。画面は0.92のまま。zip: Drive `Snap_Goban_v3.0.19.zip`

# 2026-10-30 Word用SVGの大きさと線をGoWriteの実測に（v3.0.20）

- 三村さんの比較で snap-goban だけ約2.5倍の大きさ（幅106mm、GoWriteは43mm）
- GoWriteのEMF実測: MM_HIMETRIC・1路420＝4.2mm、罫線と石の縁 0.09mm、盤端 0.31mm、石の直径 1路の0.98
- 🔴 WordはSVGのstrokeを約0.3mmより細く描かない（1単位も3単位も0.296mm、10単位は1.058mmで正しい）。塗りつぶしは指定どおり（0.085mm）
- 対策: 罫線は細長いrect、石の縁は黒円＋白円の重ね。大きさはmm指定
- commit は v3.0.20。zip: Drive `Snap_Goban_v3.0.20.zip`

# 2026-10-30 画面では抜き跡の手を今の番号で（v3.0.21）

- 三村さん指摘: 6の抜き跡に打った9手目が画面でも「6」。貼り付けの図は正しいが画面は9と見せるべき
- displayBoard を今の盤面に戻した（ede234b の逆）。Word・印刷は stonesToDraw で最初の手を上描き＋凡例のまま
- 上描き地点の画面の数字（board-marker）を除き、二重描きを防いだ
- zip: Drive `Snap_Goban_v3.0.21.zip`
- 残り: YOGAProの開発版でGoWriteと並べて確認 → ストア提出
