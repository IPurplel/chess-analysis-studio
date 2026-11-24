# Third-party material

- **Stockfish** (GPLv3) is not stored in this repository. The Docker build downloads the official release
  from github.com/official-stockfish/Stockfish and verifies its SHA-256 checksum.
- **Opening names / ECO codes** in `data/openings/*.tsv` come from lichess-org/chess-openings (CC0 1.0).
- **Chessground** (GPLv3) and **chess.js** (BSD-2) are used through npm; piece artwork is cburnett (GPLv2+) via Chessground.
- Game data is fetched at runtime from the public chess.com and lichess APIs and stays on your server.

This project is not affiliated with or endorsed by chess.com or lichess.
