# Engine Sound Simulator

アクセル開度・気筒数・燃焼位相から回転と燃焼を計算し、ブラウザで動的にエンジン音を合成する Web アプリのプロジェクトです。録音済みエンジン音の切り替えは使用しません。

まず4ストロークのバイクから始め、将来は自動車へ拡張します。

**現在は1〜4気筒モデルに対応しています。AudioWorklet 内で回転・燃焼位相・解析的な燃焼パルスを音声時間から計算し、停止中にプリセットと720°周期の燃焼位相を編集できます。画面では開始・停止、音量、ミュート、スライダー・数値・ホールドによるアクセル、簡易ダイノ負荷を操作でき、RPM、実効開度、レブリミッター状態に加えて、適用中構成の燃焼列、現在波形、周波数スペクトルを表示します。**

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
make test    # AudioWorklet と音声 controller の単体テスト
make e2e     # Chromium で開発版・本番版の製品音声操作を検証
make ci      # workflow / Dockerfile / 秘密情報検査を含む全チェック
make shell   # 開発ツールのコンテナに入る
```

開発ツールのコンテナは非 root で実行し、依存関係はコンテナ側の
volume に保持します。E2E は Playwright 公式コンテナ内の Chromium で
実行します。製品利用時に音を計算・出力するのは Windows 側のブラウザです。

## 起動と使い方

Docker EngineまたはDocker DesktopのWSL integrationを起動してから、次を実行します。

```bash
make dev
```

ブラウザで <http://localhost:5173> を開き、`音声を開始` を選ぶと合成を開始します。
アクセル、押している間だけ開く操作、簡易ダイノ負荷、音量、ミュートを実行中に
変更できます。プリセットと燃焼位相は音声を停止してから編集・適用し、次の開始時に
反映します。終了時は `Ctrl+C` で開発サーバーを止め、必要に応じて `make down` で
Composeサービスを停止します。

## 対応範囲とモデル値

現在の利用可能版は4ストローク（720°周期）の1〜4気筒モデルを対象とし、
単気筒、360°／180°／270°並列2気筒、等間隔3気筒、等間隔4気筒の
プリセットを含みます。2気筒プリセットの一周期内の燃焼間隔は、それぞれ
`360°/360°`、`180°/540°`、`270°/450°` です。

プリセットのトルク、慣性、吸排気パラメーターと燃焼位相は、実車の測定値ではなく
シミュレーター用の合成モデル値です。録音済みループは使わず、AudioWorklet内で
回転と燃焼イベントから音声を生成します。燃焼パルスには管長・減衰・マフラー量から
導く安定な排気共鳴を適用し、開度と負荷に連動するseed付きの帯域制限吸気ノイズを
加えます。さらに、構成で指定したseedによる小幅な燃焼パルス変動と、クランク回転に
同期する低ゲインの機械次数音を合成します。同じ構成・seed・操作列で再開または構成を
再適用すると、同じ変動列から生成を始めます。実ブラウザ横断と長時間性能の検証は
今後の範囲です。

## 開発と運用

- [番号付きチケット一覧](docs/tickets/README.md)
- [「チケット1を対応して」から Draft PR まで](docs/development-workflow.md)
- [開発手順・PR の方針](CONTRIBUTING.md)
- [GitHub 設定・ブランチルール](docs/repository-setup.md)
- [参考にしたアプリ](https://github.com/greentiger0789/ollama-discord-chat-app-docker)

main への変更は PR と CI 成功を必須にします。ライセンスは未選定です。
