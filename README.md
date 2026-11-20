# Pilah Pil 💊

Game santai 3D di browser: sortir pil warna-warni ke wadah yang warnanya sama, sendirian, berdua sama pasangan, atau **bareng sampai 10 orang**. Makin tinggi levelnya, mejanya makin luas dan makin susah.

## Cara main

- **Spatula**: tahan klik/sentuh lalu geser untuk mendorong pil. Scroll mouse atau **Q / E** untuk memutar.
- **Jepit**: tekan **Spasi** (atau klik kanan) untuk ganti alat, lalu tahan klik untuk mengangkat sampai 6 pil sekaligus.
- Pil yang masuk ke wadah dengan warna yang salah akan terpental keluar.
- **1–6** untuk emote, **Enter** untuk chat (di mode room).
- Level selesai kalau semua pil sudah tersortir. Level berikutnya mulai otomatis.

## Main bareng teman & pasangan

1. Klik **Buat room**. Kamu dapat kode 4 huruf, misalnya `KQTM`.
2. Klik **Salin link** lalu kirim ke teman atau pasangan, atau suruh mereka ketik kodenya di **Gabung**.
3. Semua orang menyortir di meja yang sama. Skor dihitung per orang, dan di akhir level ada daftar siapa yang paling banyak menyortir.

Browser si pembuat room yang menjalankan permainan, jadi **tab host harus tetap terbuka**. Kalau host keluar, room-nya bubar.

## Kamera (tanpa suara)

Di dalam room, klik tombol 📷 untuk menyalakan kamera. Wajahmu muncul sebagai bulatan kecil dengan nama di layar semua pemain. Klik lagi untuk mematikan.

- Hanya video, **audio tidak pernah diminta**.
- Kamera baru menyala setelah kamu klik tombolnya dan browser minta izin. Tidak ada yang bisa menyalakan kamera orang lain.
- Video dikirim langsung antar browser, tidak lewat server dan tidak disimpan.
- Kamera hanya jalan lewat link `https://` (misalnya GitHub Pages) atau `localhost`.

## Main di HP

- **1 jari**: geser untuk menggerakkan & mendorong. **2 jari**: putar spatula. Bisa juga pakai tombol ⟲ ⟳.
- Kalau HP tegak, meja otomatis diputar memanjang ke atas. Kalau HP miring, meja melebar.
- Tombol ⛶ untuk layar penuh (Android). 😊 untuk membuka emote. 👥 untuk daftar pemain & chat.
- Grafis otomatis diringankan di HP biar tetap lancar.

## Tingkat kesulitan

| Level | Yang berubah |
|---|---|
| 1–2 | 2 warna, meja kecil |
| 3+ | Muncul palang permen; pil mentok, tapi spatula bisa lewat di atasnya |
| 4+ | Pil tersebar di beberapa tumpukan |
| 6+ | Wadahnya mulai bergeser pelan-pelan |
| tiap level | +1 warna tiap 2 level (maks 7), lebih banyak pil (sampai 210), meja makin luas, dan lantainya makin licin |

## Menjalankan

Cuma file statis, tidak perlu build dan tidak perlu server game sendiri.

- **Lokal**: `python3 -m http.server 8080` lalu buka http://localhost:8080
  (harus lewat server, karena membuka `index.html` langsung dari file tidak jalan untuk ES module).
- **Online gratis (GitHub Pages)**: di repo GitHub buka *Settings → Pages*, pilih *Deploy from a branch*, pilih branch-nya dan folder `/ (root)`. Nanti link-nya berbentuk `https://<username>.github.io/separating-color-game/`.

## Teknis

- `js/levels.js`: generator level (warna, ukuran meja, wadah, palang, posisi pil)
- `js/sim.js`: fisika pil, spatula, jepit, dan pengecekan wadah
- `js/render3d.js`: tampilan 3D pakai [three.js](https://threejs.org) (MIT, di-vendor di `js/vendor/`): pil kapsul & tablet glossy, wadah, palang permen, spatula dengan hiasan (hati, bintang, bunga, awan, permata) per pemain
- `js/cam.js`: kamera opsional (video saja) antar pemain lewat WebRTC
- `js/net.js`: multiplayer peer-to-peer lewat WebRTC ([PeerJS](https://peerjs.com), MIT, di-vendor di `js/vendor/`)
- `js/main.js`: lobby, input, loop game, sinkronisasi host ↔ tamu

Host menjalankan simulasi dan mengirim posisi pil ±20× per detik. Tamu mengirim posisi tangannya. PeerJS memakai server sinyal publik gratis `0.peerjs.com` hanya untuk mempertemukan browser. Kalau mau pakai PeerServer sendiri, tambahkan `?peerhost=HOST&peerport=PORT&peerpath=/PATH` di URL.
