# snap-goban — ブラウザ拡張棋譜エディタ

## 基本情報
- **技術**: Vite/React/TypeScript/Tailwind/ブラウザ拡張
- **GitHub**: igomimu/snap-goban
- **バージョン**: v3.0.23（2026-10-30 開発版で三村さん確認済み・ストア提出待ち。ストア版は3.0.13）
- **状態**: 凍結解除（2026-10-30）。Word貼り付けの白黒反転を解決

## UI/Design Standards
→ 詳細は `~/.claude/CLAUDE.md` の「UI/Design Standards」セクションを参照
- **Anti-AI Design**: グラデ・グロー・glassmorphism禁止、左揃え基調、装飾より情報
- **統一デザイン言語**: shadcn/ui + Tailwind、Inter + Noto Sans JP、Lucide icons
- **primary色**: slate-700（エディタ、落ち着いたプロ向け）
- **参考**: Linear, Vercel Dashboard

## 機能
- SGF棋譜編集
- Wordへ直接貼れる図（SVGをクリップボードへ。GoWriteと同じ見た目・1路3.9mm、v3.0.23〜）。EMFモードは廃止
- i18n（日本語・英語・中国語）
- Chrome Web Store公開済み。🔴提出用zipは `npm run build && python3 scripts/package_store.py`（manifest の key は開発版ID固定用なのでストア用zipから外す。残すと拒否される）
