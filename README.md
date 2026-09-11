# Engine Sound Simulator

アクセル開度・気筒数・燃焼位相から回転と燃焼を計算し、ブラウザで動的にエンジン音を合成する Web アプリのプロジェクトです。録音済みエンジン音の切り替えは使用しません。

まず4ストロークのバイクから始め、将来は自動車へ拡張します。

**現在は設計・開発基盤の整備段階です。Web UI と音声シミュレーター本体はまだ実装していません。**

## 実装計画

[実装計画書](docs/implementation-plan.md)に、技術選定、回転・燃焼モデル、音声合成、Docker / WSL 構成、段階ごとの完了条件をまとめています。

- UI: React + TypeScript + Vite
- 音声: Web Audio API / AudioWorklet によるリアルタイム合成
- 開発: Docker Compose + Node.js 24 LTS
- 検証: 数値テストとブラウザ検証を実装に合わせて追加

## 現在の開発環境

Docker Engine または Docker Desktop の WSL integration と、Docker Compose が必要です。ホスト側の Node.js は不要です。

```bash
make check   # コンテナのビルド、整形・Markdown の検証
make format  # コンテナ内で整形
make ci      # workflow / Dockerfile / 秘密情報検査を含む全チェック
make shell   # 開発ツールのコンテナに入る
```

コンテナは非 root で実行し、依存関係はコンテナ側の volume に保持します。音声実装後も、音を計算・出力するのは Windows 側のブラウザです。

## 開発と運用

- [開発手順・PR の方針](CONTRIBUTING.md)
- [GitHub 設定・ブランチルール](docs/repository-setup.md)
- [参考にしたアプリ](https://github.com/greentiger0789/ollama-discord-chat-app-docker)

main への変更は PR と CI 成功を必須にします。ライセンスは未選定です。
